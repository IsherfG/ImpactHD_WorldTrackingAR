import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ARButton } from "three/examples/jsm/webxr/ARButton.js"; // Standard, but its role might be diminished by SDK
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import "./qr.js";
import "./style.css";

// --- On-Screen Logger ---
const MAX_LOG_ENTRIES = 50;
let onScreenLogElement = null;

function appLog(...args) {
  console.log(...args); // Keep console logging
  if (onScreenLogElement) {
    const message = args.map(arg => {
      if (typeof arg === 'object' && arg !== null) {
        try {
          const replacer = (key, value) => {
            if (value instanceof THREE.Vector3) return `Vec3(${value.x.toFixed(2)}, ${value.y.toFixed(2)}, ${value.z.toFixed(2)})`;
            if (value instanceof THREE.Quaternion) return `Quat(${value.x.toFixed(2)}, ${value.y.toFixed(2)}, ${value.z.toFixed(2)}, ${value.w.toFixed(2)})`;
            return typeof value === 'number' && !Number.isFinite(value) ? String(value) : typeof value === 'number' ? parseFloat(value.toFixed(3)) : value;
          };
          return JSON.stringify(arg, replacer, 2);
        } catch (e) { return '[Unserializable Object]'; }
      }
      return String(arg);
    }).join(' ');
    const logEntry = document.createElement('div');
    logEntry.textContent = message;
    onScreenLogElement.appendChild(logEntry);
    while (onScreenLogElement.childNodes.length > MAX_LOG_ENTRIES) {
      onScreenLogElement.removeChild(onScreenLogElement.firstChild);
    }
    onScreenLogElement.scrollTop = onScreenLogElement.scrollHeight;
  }
}
// --- End On-Screen Logger ---

// --- Global Variables ---
let container;
let camera, scene, renderer; // Your main camera, scene, renderer
let reticle; // For ARButton's hit-testing, may or may not be used by SDK
let object1, object2, object3, object4, object5;
let hitTestSource = null;
let hitTestSourceRequested = false;
let planeFound = false;
const DEFAULT_OBJECT_SCALE = 0.2;
let currentScale = DEFAULT_OBJECT_SCALE;
let lastPlacedObject = null;
let allPlacedObjects = [];
let selectedForManipulationObject = null;
let originalMaterials = new Map();
const SELECTION_COLOR = 0xffaa00;
const MOVE_SENSITIVITY = 0.002;
const HDR_ENVIRONMENT_MAP_PATH = 'hdr.hdr';
let initialPinchDistance = null, pinchScaling = false;
let initialPinchAngle = null, pinchRotating = false;
let moving = false, initialTouchPosition = null;
let threeFingerMoving = false, initialZPosition = null, initialThreeFingerY = null;
const raycaster = new THREE.Raycaster();
const tapPosition = new THREE.Vector2();
let rayDebugLine = null;
let selectedObject = "obj1";
let lastFoundSDKCamera = null;

// --- UI Helper ---
function updateSelectedObjectButton(selectedId) {
    document.querySelectorAll('.object-btn').forEach(btn => {
        btn.classList.remove('selected');
        if (btn.dataset.objectId === selectedId) btn.classList.add('selected');
    });
}

// --- WebXR Support & Session Check (Minimal) ---
// We assume Variant Launch SDK (from script tag) handles actual session start.
// This just checks for basic browser support.
if ("xr" in navigator) {
  navigator.xr.isSessionSupported("immersive-ar").then((supported) => {
    if (supported) {
        document.getElementById("ar-not-supported").style.display = "none";
        appLog("Browser supports immersive-ar.");
    } else {
        const msg = "Browser does not support immersive-ar. Variant Launch might use alternative AR tech.";
        document.getElementById("ar-not-supported").innerHTML = msg;
        appLog(msg);
    }
    init(); // Always init Three.js scene setup
    animate();
  }).catch((err) => {
    const msg = "AR support check error:";
    document.getElementById("ar-not-supported").innerHTML = msg + " " + (err.message || err);
    appLog(msg, err);
    init();
    animate();
  });
} else {
    const msg = "WebXR API (navigator.xr) not found. Relying on Variant Launch.";
    document.getElementById("ar-not-supported").innerHTML = msg;
    appLog(msg);
    init();
    animate();
}

// sessionStart for ARButton - may not be relevant if Variant Launch controls the session.
function sessionStart() {
  planeFound = false; // Reset ARButton specific flags
  document.getElementById("tracking-prompt").style.display = "flex";
  document.getElementById("bottom-controls").style.display = "none";
  if (selectedForManipulationObject) deselectObject(selectedForManipulationObject);
  document.getElementById("delete-object-btn").style.display = "none";
  if (rayDebugLine) rayDebugLine.visible = false;
  appLog("ARButton: XR Session Started (if ARButton was used).");
}

// --- Material Management ---
// ... (These functions are fine and self-contained: storeOriginalMaterials, restoreOriginalMaterials, highlightSelectedObject, selectObject, deselectObject)
function storeOriginalMaterials(object) {
    if (originalMaterials.has(object)) return;
    const materialsToStore = [];
    object.traverse(child => {
        if (child.isMesh && child.material) {
            const matClone = child.material.clone();
            matClone.userData = { isOriginal: true };
            materialsToStore.push({ mesh: child, material: matClone });
        }
    });
    originalMaterials.set(object, materialsToStore);
}
function restoreOriginalMaterials(object) {
    if (originalMaterials.has(object)) {
        const materialsInfo = originalMaterials.get(object);
        materialsInfo.forEach(info => {
            if (info.mesh.material !== info.material && !info.mesh.material.userData?.isOriginal) {
                info.mesh.material.dispose();
            }
            info.mesh.material = info.material;
        });
    }
}
function highlightSelectedObject(object) {
    storeOriginalMaterials(object);
    object.traverse(child => {
        if (child.isMesh && child.material) {
            const originalChildMaterial = originalMaterials.get(object)?.find(m => m.mesh === child)?.material;
            if (child.material !== originalChildMaterial && !child.material.userData?.isOriginal) {
                 child.material.dispose();
            }
            const highlightMaterial = new THREE.MeshStandardMaterial({
                color: SELECTION_COLOR,
                emissive: SELECTION_COLOR,
                emissiveIntensity: 0.4,
                map: originalChildMaterial?.map || null,
            });
            child.material = highlightMaterial;
        }
    });
}
function selectObject(object) {
    if (selectedForManipulationObject === object) return;
    if (selectedForManipulationObject) deselectObject(selectedForManipulationObject);
    selectedForManipulationObject = object;
    highlightSelectedObject(object);
    document.getElementById("delete-object-btn").style.display = "flex";
    currentScale = selectedForManipulationObject.scale.x;
    appLog("Selected for manipulation:", object.name || "Unnamed Object");
}
function deselectObject(object) {
    if (!object) return;
    restoreOriginalMaterials(object);
    if (selectedForManipulationObject === object) {
        appLog("Deselected:", object.name || "Unnamed Object");
        selectedForManipulationObject = null;
        document.getElementById("delete-object-btn").style.display = "none";
    }
}

//HELLO
// --- Initialization ---
function init() {
  onScreenLogElement = document.getElementById('on-screen-logger');
  if (!onScreenLogElement) console.error("On-screen logger element not found!");

  container = document.createElement("div"); document.body.appendChild(container);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
  camera.name = "MyMainCamera"; // Give your camera a name for easier identification
  camera.matrixAutoUpdate = false; // Important if we were to manage it via Three.js XR

  appLog("Main camera created:", camera.name, camera.uuid);

  const hemiLight = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 0.6); scene.add(hemiLight);
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.4); scene.add(ambientLight);
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(1.5, 2, 1).normalize(); directionalLight.castShadow = true;
  Object.assign(directionalLight.shadow, { mapSize: new THREE.Vector2(1024, 1024), camera: Object.assign(new THREE.OrthographicCamera(), { near: 0.1, far: 10, left: -2, right: 2, top: 2, bottom: -2 }), bias: -0.001 });
  scene.add(directionalLight);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true; // Enable XR on the renderer is standard
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // ARButton - Standard Three.js way to enter XR.
  // The Variant Launch SDK (from script tag in HTML) might provide its own AR entry UI/method.
  // If Variant Launch starts AR automatically or has its own button, this ARButton might be
  // redundant or could even conflict. For now, it's a way to try and trigger an XR session
  // to see if our camera finding logic works within any active session.
  renderer.xr.addEventListener("sessionstart", sessionStart);
  const arButton = ARButton.createButton(renderer, {
    requiredFeatures: ["local", "hit-test", "dom-overlay"],
    domOverlay: { root: document.querySelector("#overlay") },
  });
  // Add ARButton to allow user to try and start a session if SDK doesn't auto-start.
  // This might be hidden or removed if SDK provides its own UI.
  if (!document.getElementById('ar-button')) { // Simple check to avoid adding multiple if re-run
      arButton.id = 'ar-button';
      document.body.appendChild(arButton);
      appLog("ARButton created and added to body.");
  }


  const lineMaterial = new THREE.LineBasicMaterial({ color: 0xff00ff, linewidth: 5 });
  const points = [new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,-1)];
  const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
  rayDebugLine = new THREE.Line(lineGeometry, lineMaterial);
  rayDebugLine.frustumCulled = false; rayDebugLine.visible = false;
  scene.add(rayDebugLine);

  new RGBELoader().setPath('').load(HDR_ENVIRONMENT_MAP_PATH, (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping; scene.environment = texture;
    appLog(`Env map '${HDR_ENVIRONMENT_MAP_PATH}' loaded.`);
  }, undefined, (err) => appLog(`HDR Load Error for '${HDR_ENVIRONMENT_MAP_PATH}':`, err.message || err));


  document.getElementById("place-object-btn").addEventListener("click", onSelect);
  document.getElementById("delete-object-btn").addEventListener("click", () => {
    if (selectedForManipulationObject) {
      const objectName = selectedForManipulationObject.name || "Unnamed Object";
      scene.remove(selectedForManipulationObject);
      allPlacedObjects = allPlacedObjects.filter(obj => obj !== selectedForManipulationObject);
      originalMaterials.delete(selectedForManipulationObject);
      selectedForManipulationObject.traverse(child => {
        if (child.isMesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if(Array.isArray(child.material)) child.material.forEach(mat => { if(mat.map) mat.map.dispose(); mat.dispose(); });
            else { if(child.material.map) child.material.map.dispose(); child.material.dispose(); }
          }
        }
      });
      selectedForManipulationObject = null;
      document.getElementById("delete-object-btn").style.display = "none";
      appLog("Object deleted:", objectName);
    }
  });
  document.querySelectorAll('.object-btn').forEach(button => {
    button.addEventListener('click', (event) => {
        event.stopPropagation(); selectedObject = button.dataset.objectId; updateSelectedObjectButton(selectedObject);
        appLog("Switched to object type:", selectedObject);
    });
  });
  const firstObjBtn = document.querySelector('.object-btn');
  if(firstObjBtn){ selectedObject = firstObjBtn.dataset.objectId; updateSelectedObjectButton(selectedObject); }

  reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.075, 0.1, 24).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, side: THREE.DoubleSide })
  );
  reticle.matrixAutoUpdate = false; reticle.visible = false; scene.add(reticle);

  const gltfLoader = new GLTFLoader(); const textureLoader = new THREE.TextureLoader();
  const loadErrCb = (name)=>(e)=>appLog(`Error loading ${name}:`, e.message || e);
  function applyTex(gltfScn, tex){ gltfScn.traverse(n=>{if(n.isMesh){let m; if(n.material?.isMeshStandardMaterial)m=n.material.clone();else{m=new THREE.MeshStandardMaterial();if(n.material?.color)m.color.copy(n.material.color);} m.map=tex;m.needsUpdate=true;n.material=m;}}); }

  gltfLoader.load("Shelf.glb", (g) => { object1 = g.scene; if(object1) object1.name = "Shelf_GLTF_Root"; appLog("Shelf.glb loaded");}, undefined, loadErrCb("Shelf.glb"));
  textureLoader.load("Shelf.png", (t) => { t.flipY=false; t.encoding=THREE.sRGBEncoding; gltfLoader.load("Shelf2.glb", (g) => { object2=g.scene; if(object2){ object2.name = "Shelf2_GLTF_Root"; applyTex(object2,t); appLog("Shelf2.glb loaded");} }, undefined, loadErrCb("Shelf2.glb")); }, undefined, loadErrCb("Shelf.png"));
  textureLoader.load("Map1.png", (t) => { t.flipY=false; t.encoding=THREE.sRGBEncoding; gltfLoader.load("Bag1.glb", (g) => { object3=g.scene; if(object3){ object3.name = "Bag1_GLTF_Root"; applyTex(object3,t); appLog("Bag1.glb loaded");} }, undefined, loadErrCb("Bag1.glb")); }, undefined, loadErrCb("Map1.png"));
  textureLoader.load("Map2.jpg", (t) => { t.flipY=false; t.encoding=THREE.sRGBEncoding; gltfLoader.load("Bag2.glb", (g) => { object4=g.scene; if(object4){ object4.name = "Bag2_GLTF_Root"; applyTex(object4,t); appLog("Bag2.glb loaded");} }, undefined, loadErrCb("Bag2.glb")); }, undefined, loadErrCb("Map2.jpg"));
  textureLoader.load("Map3.png", (t) => { t.flipY=false; t.encoding=THREE.sRGBEncoding; gltfLoader.load("Bag3.glb", (g) => { object5=g.scene; if(object5){ object5.name = "Bag3_GLTF_Root"; applyTex(object5,t); appLog("Bag3.glb loaded");} }, undefined, loadErrCb("Bag3.glb")); }, undefined, loadErrCb("Map3.png"));

  window.addEventListener("resize", onWindowResize);
  window.addEventListener("touchstart", onTouchStart, { passive: false });
  window.addEventListener("touchmove", onTouchMove, { passive: false });
  window.addEventListener("touchend", onTouchEnd, false);
  appLog("Initialization complete. Main camera matrixAutoUpdate:", camera.matrixAutoUpdate);
}

// onSelect for custom object placement using ARButton's reticle
function onSelect() {
  if (reticle.visible) { // Reticle is from ARButton's hit-test logic
    let modelToClone;
    if (selectedObject === "obj1" && object1) modelToClone = object1;
    else if (selectedObject === "obj2" && object2) modelToClone = object2;
    else if (selectedObject === "obj3" && object3) modelToClone = object3;
    else if (selectedObject === "obj4" && object4) modelToClone = object4;
    else if (selectedObject === "obj5" && object5) modelToClone = object5;

    if (modelToClone) {
      const mesh = modelToClone.clone();
      mesh.name = (modelToClone.name || "ClonedObject") + "_instance_" + Date.now();
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.traverse(child => { if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; }});

      const newPosition = new THREE.Vector3(); const newQuaternion = new THREE.Quaternion();
      reticle.matrix.decompose(newPosition, newQuaternion, new THREE.Vector3());
      mesh.position.copy(newPosition); mesh.quaternion.copy(newQuaternion);
      mesh.scale.set(currentScale, currentScale, currentScale);

      let activeCamera = findPossibleSDKCamera(scene, camera) || camera;
      const camLookAt = new THREE.Vector3();
      activeCamera.getWorldPosition(camLookAt);
      mesh.lookAt(camLookAt.x, mesh.position.y, camLookAt.z);

      scene.add(mesh);
      lastPlacedObject = mesh; allPlacedObjects.push(mesh);
      appLog("Placed object (custom via ARButton reticle):", mesh.name, "at", newPosition);

      if (selectedForManipulationObject && selectedForManipulationObject !== mesh) deselectObject(selectedForManipulationObject);
      selectObject(mesh);

      const targetScaleVal = mesh.scale.x; mesh.scale.setScalar(targetScaleVal * 0.1);
      const animStartTime = performance.now();
      function animateEntry() {
        if (!mesh.parent) return;
        const elapsed = performance.now() - animStartTime;
        if (elapsed >= 300) { mesh.scale.setScalar(targetScaleVal); return; }
        const progress = 1 - Math.pow(1 - (elapsed / 300), 3);
        mesh.scale.setScalar(targetScaleVal * 0.1 + targetScaleVal * 0.9 * progress);
        requestAnimationFrame(animateEntry);
      }
      requestAnimationFrame(animateEntry);
    } else appLog("Model to clone not found for ID:", selectedObject);
  } else appLog("Attempted to place (custom), but ARButton reticle not visible.");
}

function onWindowResize() { camera.aspect = window.innerWidth/window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); appLog("Window resized."); }

function animate() {
  renderer.setAnimationLoop(render);
}

// render loop
function render(timestamp, frame) { // `frame` is XRFrame if in XR session started by ARButton
  // Hit-test logic for ARButton (may be irrelevant if SDK handles placement/interaction)
  if (renderer.xr.isPresenting && frame && hitTestSourceRequested) {
    const referenceSpace = renderer.xr.getReferenceSpace();
    if (hitTestSource && referenceSpace) {
        const hitTestResults = frame.getHitTestResults(hitTestSource);
        if(hitTestResults.length){
            if(!planeFound){ // This planeFound is for ARButton's UI
                planeFound = true;
                document.getElementById("tracking-prompt").style.display = "none";
                document.getElementById("bottom-controls").style.display = "flex";
                appLog("ARButton: Plane found, controls visible.");
            }
            const hit = hitTestResults[0]; const pose = hit.getPose(referenceSpace);
            if(pose){ reticle.visible = true; reticle.matrix.fromArray(pose.transform.matrix); }
            else { reticle.visible = false;}
        } else { reticle.visible = false; }
    }
  } else if (!renderer.xr.isPresenting && planeFound) { // If session ended, hide ARButton UI
      planeFound = false;
      document.getElementById("tracking-prompt").style.display = "flex"; // Or hide, depending on desired state
      document.getElementById("bottom-controls").style.display = "none";
      reticle.visible = false;
  }


  // Determine which camera to render with
  let cameraToRenderWith = camera; // Default to your main camera
  if (renderer.xr.isPresenting) { // Or a check for Variant Launch session activity
      const sdkCam = findPossibleSDKCamera(scene, camera);
      if (sdkCam) {
          cameraToRenderWith = sdkCam;
      }
      // If using standard Three.js XR via ARButton, renderer.render will internally use
      // the XR camera views if your main `camera` is the one associated with renderer.xr.camera.
      // If an SDK provides `sdkCam`, and it's the *actual* AR camera, we'd want to use that.
      // This line becomes complex with an SDK potentially managing the renderer.
  }
  renderer.render(scene, cameraToRenderWith);
}


// --- Helper function to find a potential SDK-managed camera ---
function findPossibleSDKCamera(sceneRef, yourCameraRef) {
    let foundCamera = null;
    sceneRef.traverse(object => {
        if (foundCamera) return; // Optimization: stop if already found
        if (object.isCamera && object !== yourCameraRef) {
            // Heuristic: try to avoid internal/default cameras if they have common names.
            // SDK camera might be unnamed or have a generic name.
            const name = object.name ? object.name.toLowerCase() : '';
            if (!name.includes("renderer") && !name.includes("default")) {
                foundCamera = object;
            } else if (!object.name) { // Unnamed cameras are also candidates
                foundCamera = object;
            }
        }
    });
    return foundCamera;
}

// --- Helper function for logging camera state ---
function logCameraDebugState(prefix, cam) {
    if (!cam) {
        appLog(`${prefix} - Camera object is null.`);
        return;
    }
    const position = new THREE.Vector3();
    // ASSUMPTION: cam.matrixWorld is up-to-date by the time this is called.
    // If SDK camera, SDK updates it. If our camera, renderer.xr.getCamera() or manual update.
    cam.matrixWorld.decompose(position, new THREE.Quaternion(), new THREE.Vector3());
    appLog(`${prefix} - Cam Name: ${cam.name || 'UnnamedCam'}, UUID: ${cam.uuid.substring(0,8)}, World Pos: X=${position.x.toFixed(2)}, Y=${position.y.toFixed(2)}, Z=${position.z.toFixed(2)}`);
}

function onTouchStart(event) {
  let targetElement = event.target; let uiTap = false;
  let currentElement = targetElement;
  while (currentElement && currentElement !== document.body) {
    if (currentElement.dataset?.ignoreTap === 'true' ||
        currentElement.id === 'object-selector' ||
        currentElement.id === 'action-buttons' ||
        currentElement.closest('.object-btn') ||
        currentElement.closest('.action-btn')) {
      uiTap = true; break;
    }
    currentElement = currentElement.parentElement;
  }

  if (uiTap) { appLog("UI tap ignored for raycasting."); moving = pinchScaling = pinchRotating = threeFingerMoving = false; return; }

  if (event.touches.length === 1) {
    tapPosition.x = (event.touches[0].clientX / window.innerWidth) * 2 - 1;
    tapPosition.y = -(event.touches[0].clientY / window.innerHeight) * 2 + 1;

    appLog("--- Touch Start --- (Tap Pos:", tapPosition.x.toFixed(2), tapPosition.y.toFixed(2) + ")");

    let cameraForRaycast = camera; // Default to your main camera

    // Check if an XR session is active (could be via ARButton or Variant Launch SDK)
    const xrIsPresenting = renderer.xr.isPresenting; // Standard Three.js check
    appLog(`XR Presenting (Three.js check): ${xrIsPresenting}`);

    if (xrIsPresenting) {
        appLog("Attempting to use best available camera for raycast in XR...");
        const sdkCamera = findPossibleSDKCamera(scene, camera);

        if (sdkCamera) {
            if (lastFoundSDKCamera !== sdkCamera) { // Log only if it's a new find or first find
                appLog("Found a potential SDK camera in scene:", sdkCamera.name || 'UnnamedSDKCam', `UUID: ${sdkCamera.uuid.substring(0,8)}`);
                lastFoundSDKCamera = sdkCamera;
            }
            // We ASSUME the SDK keeps this camera's matrixWorld updated for its own AR rendering.
            logCameraDebugState("SDK Camera State (assumed updated by SDK)", sdkCamera);
            cameraForRaycast = sdkCamera;
        } else {
            appLog("No other camera found in scene. Falling back to main 'MyMainCamera'.");
            if (lastFoundSDKCamera) { // If we previously found one and now it's gone
                appLog("Previously found SDK camera is no longer in the scene.");
                lastFoundSDKCamera = null;
            }
            // If no SDK camera, try updating 'MyMainCamera' using Three.js's XR system.
            // This was the part that was previously failing (staying at 0,0,0).
            logCameraDebugState("MyMainCamera State (before renderer.xr.getCamera)", camera);
            renderer.xr.getCamera(camera); // Attempt to update 'MyMainCamera' from XR session
            logCameraDebugState("MyMainCamera State (after renderer.xr.getCamera)", camera);
            cameraForRaycast = camera;
        }
    } else {
        appLog("Not in XR presenting mode (by Three.js check). Using 'MyMainCamera'.");
        // In a non-XR scenario, if camera.matrixAutoUpdate is false, you'd call
        // camera.updateMatrixWorld(true) if you changed camera.position/rotation/scale.
        cameraForRaycast = camera;
    }

    if (cameraForRaycast) {
        // Ensure the chosen camera's matrixWorld is truly up-to-date before raycasting.
        // For an SDK camera, we rely on the SDK.
        // For 'MyMainCamera', renderer.xr.getCamera() should handle it in XR.
        // An explicit cameraForRaycast.updateMatrixWorld() might be needed if only local
        // transforms were set and matrixAutoUpdate is false, but less likely for XR poses.
        raycaster.setFromCamera(tapPosition, cameraForRaycast);
        appLog(`Raycasting with camera: ${cameraForRaycast.name || cameraForRaycast.uuid.substring(0,8)}`);
        appLog(`Ray Origin: X=${raycaster.ray.origin.x.toFixed(2)}, Y=${raycaster.ray.origin.y.toFixed(2)}, Z=${raycaster.ray.origin.z.toFixed(2)}`);
    } else {
        appLog("Cannot raycast, no valid camera determined.");
        if (rayDebugLine) rayDebugLine.visible = false;
        return;
    }

    if (rayDebugLine) {
      const rayPoints = [raycaster.ray.origin.clone(), raycaster.ray.origin.clone().add(raycaster.ray.direction.clone().multiplyScalar(50))];
      rayDebugLine.geometry.setFromPoints(rayPoints);
      rayDebugLine.geometry.attributes.position.needsUpdate = true;
      rayDebugLine.visible = true;
    }

    const intersects = raycaster.intersectObjects(allPlacedObjects, true);
    if (intersects.length > 0) {
      let intersectedMesh = intersects[0].object;
      let tappedObjectRoot = null;
      let tempCurrent = intersectedMesh;
      while (tempCurrent) {
        if (allPlacedObjects.includes(tempCurrent)) { tappedObjectRoot = tempCurrent; break; }
        if (!tempCurrent.parent || tempCurrent.parent === scene) break;
        tempCurrent = tempCurrent.parent;
      }
      if (tappedObjectRoot) {
          appLog("Tapped object:", tappedObjectRoot.name || "Unnamed", "Dist:", intersects[0].distance.toFixed(2));
          if (selectedForManipulationObject === tappedObjectRoot) {
              moving = true; initialTouchPosition = new THREE.Vector2(event.touches[0].pageX, event.touches[0].pageY);
          } else {
              selectObject(tappedObjectRoot);
              moving = true; initialTouchPosition = new THREE.Vector2(event.touches[0].pageX, event.touches[0].pageY);
          }
          pinchScaling = pinchRotating = threeFingerMoving = false; return;
      } else {
          if (selectedForManipulationObject) deselectObject(selectedForManipulationObject);
          appLog("Intersection with non-root mesh. Deselecting.");
      }
    } else {
      if (selectedForManipulationObject) deselectObject(selectedForManipulationObject);
      appLog("No intersection with placed objects. Deselecting if any selected.");
    }
  }

  if (!selectedForManipulationObject) { moving = pinchScaling = pinchRotating = threeFingerMoving = false; return; }
  if (event.touches.length === 3) {
    appLog("3-finger touch start for Z move.");
    threeFingerMoving = true; initialZPosition = selectedForManipulationObject.position.y; initialThreeFingerY = event.touches[0].pageY;
    pinchScaling = pinchRotating = moving = false;
  } else if (event.touches.length === 2) {
    appLog("2-finger touch start for scale/rotate.");
    pinchScaling = true; pinchRotating = true; initialPinchDistance = getPinchDistance(event.touches); initialPinchAngle = getPinchAngle(event.touches);
    moving = threeFingerMoving = false;
  }
}

function onTouchMove(event) {
  if (!selectedForManipulationObject && !moving && !pinchScaling && !threeFingerMoving) return;
  if (threeFingerMoving && event.touches.length === 3 && selectedForManipulationObject) {
    const deltaY = initialThreeFingerY - event.touches[0].pageY;
    selectedForManipulationObject.position.y = initialZPosition + (deltaY * 0.005);
  } else if (pinchScaling && event.touches.length === 2 && selectedForManipulationObject) {
    const newPinchDistance = getPinchDistance(event.touches);
    if (initialPinchDistance === null || initialPinchDistance === 0) { initialPinchDistance = newPinchDistance; return; }
    const scaleChange = newPinchDistance / initialPinchDistance;
    const newObjectScale = currentScale * scaleChange;
    selectedForManipulationObject.scale.set(newObjectScale, newObjectScale, newObjectScale);
    if (pinchRotating) {
      const newPinchAngle = getPinchAngle(event.touches);
      if (initialPinchAngle === null) { initialPinchAngle = newPinchAngle; return; }
      selectedForManipulationObject.rotation.y += (newPinchAngle - initialPinchAngle);
      initialPinchAngle = newPinchAngle;
    }
  } else if (moving && event.touches.length === 1 && selectedForManipulationObject) {
    if (initialTouchPosition === null) { initialTouchPosition = new THREE.Vector2(event.touches[0].pageX, event.touches[0].pageY); return; }
    const currentTouch = new THREE.Vector2(event.touches[0].pageX, event.touches[0].pageY);
    const dxScreen = currentTouch.x - initialTouchPosition.x;
    const dyScreen = currentTouch.y - initialTouchPosition.y;
    
    let activeCamera = camera; // Default to your main camera
    if(renderer.xr.isPresenting){
        const sdkCam = findPossibleSDKCamera(scene, camera);
        if(sdkCam) activeCamera = sdkCam;
        else { // if no SDK cam, ensure main camera is updated if we are to use it for movement context
            renderer.xr.getCamera(camera); // update main camera from XR just in case
            activeCamera = camera;
        }
    }

    const cameraRight = new THREE.Vector3().setFromMatrixColumn(activeCamera.matrixWorld, 0); cameraRight.y=0; cameraRight.normalize();
    const cameraForward = new THREE.Vector3().setFromMatrixColumn(activeCamera.matrixWorld, 2); cameraForward.negate(); cameraForward.y=0; cameraForward.normalize();
    
    const worldMoveX = cameraRight.clone().multiplyScalar(dxScreen * MOVE_SENSITIVITY);
    const worldMoveZ = cameraForward.clone().multiplyScalar(-dyScreen * MOVE_SENSITIVITY);
    selectedForManipulationObject.position.add(worldMoveX).add(worldMoveZ);
    initialTouchPosition.copy(currentTouch);
  }
}

function onTouchEnd(event) {
  if (threeFingerMoving && event.touches.length < 3) { threeFingerMoving = false; initialZPosition = null; initialThreeFingerY = null; }
  if ((pinchScaling || pinchRotating) && event.touches.length < 2) {
    if (selectedForManipulationObject) { currentScale = selectedForManipulationObject.scale.x; appLog("Gesture end, currentScale updated to:", currentScale.toFixed(3)); }
    pinchScaling = false; pinchRotating = false; initialPinchDistance = null; initialPinchAngle = null;
  }
  if (moving && event.touches.length < 1) { moving = false; initialTouchPosition = null; }
  if (event.touches.length === 0) {
    threeFingerMoving = pinchScaling = pinchRotating = moving = false;
    initialPinchDistance = null; initialPinchAngle = null; initialTouchPosition = null; initialZPosition = null; initialThreeFingerY = null;
    appLog("--- Touch End (all fingers up) ---");
  } else appLog(`--- Touch End (fingers left: ${event.touches.length}) ---`);
}

function getPinchDistance(touches) { return Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY); }
function getPinchAngle(touches) { return Math.atan2(touches[0].pageY - touches[1].pageY, touches[0].pageX - touches[1].pageX); }