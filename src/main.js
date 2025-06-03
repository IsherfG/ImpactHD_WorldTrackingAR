import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ARButton } from "three/examples/jsm/webxr/ARButton.js";
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import "./qr.js";
import "./style.css";

// --- On-Screen Logger ---
const MAX_LOG_ENTRIES = 50;
let onScreenLogElement = null;

function appLog(...args) {
  console.log(...args);
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
let camera, scene, renderer;
let reticle;
let object1, object2, object3, object4, object5;
let hitTestSource = null;
let hitTestSourceRequested = false;
let planeFound = false; // For ARButton UI
const DEFAULT_OBJECT_SCALE = 0.2;
let currentScale = DEFAULT_OBJECT_SCALE; // Used for new placements and as base for scaling gestures
let lastPlacedObject = null; // Mostly for reference, selection handles current object
let allPlacedObjects = [];
let selectedForManipulationObject = null;
let originalMaterials = new Map();
const SELECTION_COLOR = 0xffaa00;
const MOVE_SENSITIVITY = 0.0015; // Adjusted sensitivity
const HDR_ENVIRONMENT_MAP_PATH = 'hdr.hdr';
let initialPinchDistance = null, pinchScaling = false; // For pinch scale
let initialTwoFingerAngle = null, pinchRotating = false; // For two-finger rotate
let moving = false, initialTouchPosition = null; // For 1-finger drag move
let threeFingerMoving = false, initialZPosition = null, initialThreeFingerY = null; // For 3-finger Z move
const raycaster = new THREE.Raycaster(); // Still used for ARButton hit-test for placement
const tapPosition = new THREE.Vector2(); // For ARButton hit-test screen coords
let rayDebugLine = null;
let selectedObject = "obj1"; // ID of object type to place
let currentObjectIndex = -1; // Index for cycling through placed objects
let lastFoundSDKCamera = null; // To store a potential SDK camera

// --- UI Helper ---
function updateSelectedObjectButton(selectedId) {
    document.querySelectorAll('.object-btn').forEach(btn => {
        btn.classList.remove('selected');
        if (btn.dataset.objectId === selectedId) btn.classList.add('selected');
    });
}

function updateUIForSelection() {
    const hasPlacedObjects = allPlacedObjects.length > 0;
    const objectIsSelected = selectedForManipulationObject !== null;

    const prevBtn = document.getElementById("prev-object-btn");
    const nextBtn = document.getElementById("next-object-btn");
    const deleteBtn = document.getElementById("delete-object-btn");

    if (prevBtn) prevBtn.style.display = hasPlacedObjects && allPlacedObjects.length > 1 ? "flex" : "none";
    if (nextBtn) nextBtn.style.display = hasPlacedObjects && allPlacedObjects.length > 1 ? "flex" : "none";
    if (deleteBtn) deleteBtn.style.display = objectIsSelected ? "flex" : "none";

    // Example for other manipulation buttons:
    // const scaleUpBtn = document.getElementById("scale-up-btn");
    // if(scaleUpBtn) scaleUpBtn.style.display = objectIsSelected ? "flex" : "none";
}

// --- WebXR Support & Session Check ---
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
    init();
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

function sessionStart() { // For ARButton
  planeFound = false;
  document.getElementById("tracking-prompt").style.display = "flex";
  document.getElementById("bottom-controls").style.display = "none";
  if (selectedForManipulationObject) deselectObject(selectedForManipulationObject); // Deselect on session start
  // No, don't deselect here, keep selection if session restarts.
  // else if (selectedForManipulationObject) highlightSelectedObject(selectedForManipulationObject);

  document.getElementById("delete-object-btn").style.display = selectedForManipulationObject ? "flex" : "none";
  updateUIForSelection();

  if (rayDebugLine) rayDebugLine.visible = false;
  appLog("ARButton: XR Session Started (if ARButton was used).");
}

// --- Material Management & Selection ---
function storeOriginalMaterials(object) { /* ... as before ... */ }
function restoreOriginalMaterials(object) { /* ... as before ... */ }
function highlightSelectedObject(object) { /* ... as before ... */ }
// storeOriginalMaterials, restoreOriginalMaterials, highlightSelectedObject are the same as your last correct version.
// Make sure they are included. For brevity, I'm omitting their full bodies here if unchanged.
// Re-adding them for completeness:
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


function selectObject(object, newIndex = -1) {
    if (selectedForManipulationObject === object && object !== null) return; // Already selected

    if (selectedForManipulationObject) { // Deselect previous without UI update yet
        restoreOriginalMaterials(selectedForManipulationObject);
    }

    selectedForManipulationObject = object;

    if (object) {
        highlightSelectedObject(object);
        currentScale = object.scale.x; // Update global currentScale from selected object
        if (newIndex !== -1) {
            currentObjectIndex = newIndex;
        } else {
            // If called without index, find it (e.g. if selection happened some other way)
            currentObjectIndex = allPlacedObjects.indexOf(object);
        }
        appLog("Selected:", object.name || "Unnamed", "Index:", currentObjectIndex);
    } else {
        // No object is selected (e.g. after deleting the last one)
        currentObjectIndex = -1;
        appLog("No object selected.");
    }
    updateUIForSelection();
}

function deselectCurrentObject() { // Deselects the currently selected object
    if (selectedForManipulationObject) {
        const temp = selectedForManipulationObject;
        selectedForManipulationObject = null; // Clear selection first
        restoreOriginalMaterials(temp);
        appLog("Deselected:", temp.name || "Unnamed");
        currentObjectIndex = -1; // No object actively indexed by cycle
    }
    updateUIForSelection();
}

// --- Cycle Selection Functions ---
function selectNextObject() {
    if (allPlacedObjects.length === 0) { deselectCurrentObject(); return; }
    currentObjectIndex++;
    if (currentObjectIndex >= allPlacedObjects.length) currentObjectIndex = 0;
    selectObject(allPlacedObjects[currentObjectIndex], currentObjectIndex);
}

function selectPreviousObject() {
    if (allPlacedObjects.length === 0) { deselectCurrentObject(); return; }
    currentObjectIndex--;
    if (currentObjectIndex < 0) currentObjectIndex = allPlacedObjects.length - 1;
    selectObject(allPlacedObjects[currentObjectIndex], currentObjectIndex);
}

// --- Initialization ---
function init() {
  onScreenLogElement = document.getElementById('on-screen-logger');
  if (!onScreenLogElement) console.error("On-screen logger element not found!");

  container = document.createElement("div"); document.body.appendChild(container);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
  camera.name = "MyMainCamera";
  camera.matrixAutoUpdate = false;
  appLog("Main camera created:", camera.name, camera.uuid.substring(0,8));

  const hemiLight = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 0.6); scene.add(hemiLight);
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.4); scene.add(ambientLight);
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(1.5, 2, 1).normalize(); directionalLight.castShadow = true;
  Object.assign(directionalLight.shadow, { mapSize: new THREE.Vector2(1024, 1024), camera: Object.assign(new THREE.OrthographicCamera(), { near: 0.1, far: 10, left: -2, right: 2, top: 2, bottom: -2 }), bias: -0.001 });
  scene.add(directionalLight);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  renderer.xr.addEventListener("sessionstart", sessionStart);
  const arButton = ARButton.createButton(renderer, {
    requiredFeatures: ["local", "hit-test", "dom-overlay"],
    domOverlay: { root: document.querySelector("#overlay") },
  });
  if (!document.getElementById('ar-button')) {
      arButton.id = 'ar-button'; // Give it an ID to prevent duplicates if init is called again
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

  document.getElementById("place-object-btn").addEventListener("click", onSelectPlace);
  document.getElementById("delete-object-btn").addEventListener("click", () => {
    if (selectedForManipulationObject) {
      const objectName = selectedForManipulationObject.name || "Unnamed Object";
      const indexToRemove = allPlacedObjects.indexOf(selectedForManipulationObject);

      // Dispose materials and geometries
      originalMaterials.delete(selectedForManipulationObject);
      selectedForManipulationObject.traverse(child => {
        if (child.isMesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach(mat => { if (mat.map) mat.map.dispose(); mat.dispose(); });
            } else {
              if (child.material.map) child.material.map.dispose();
              child.material.dispose();
            }
          }
        }
      });
      scene.remove(selectedForManipulationObject);
      allPlacedObjects.splice(indexToRemove, 1);
      
      appLog("Object deleted:", objectName);

      if (allPlacedObjects.length > 0) {
          currentObjectIndex = Math.max(0, indexToRemove -1); // Try to select previous
          if (currentObjectIndex >= allPlacedObjects.length) { // If last was deleted, or index was 0
            currentObjectIndex = allPlacedObjects.length > 0 ? 0 : -1;
          }
          if(currentObjectIndex !== -1 && allPlacedObjects[currentObjectIndex]) {
            selectObject(allPlacedObjects[currentObjectIndex], currentObjectIndex);
          } else {
            selectObject(null); // No objects left or invalid index
          }
      } else {
          selectObject(null); // No objects left
      }
    }
  });

  document.getElementById("next-object-btn").addEventListener("click", selectNextObject);
  document.getElementById("prev-object-btn").addEventListener("click", selectPreviousObject);

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
  updateUIForSelection();
}

function onSelectPlace() { // For placing new objects
  if (reticle.visible) {
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
      mesh.scale.set(DEFAULT_OBJECT_SCALE, DEFAULT_OBJECT_SCALE, DEFAULT_OBJECT_SCALE); // Use default scale for new objects
      currentScale = DEFAULT_OBJECT_SCALE; // Reset global currentScale

      let activeCamera = findPossibleSDKCamera(scene, camera) || camera;
      const camLookAt = new THREE.Vector3();
      activeCamera.getWorldPosition(camLookAt);
      mesh.lookAt(camLookAt.x, mesh.position.y, camLookAt.z);

      scene.add(mesh);
      allPlacedObjects.push(mesh);
      lastPlacedObject = mesh;
      selectObject(mesh, allPlacedObjects.length - 1); // Select the newly placed object
      appLog("Placed object:", mesh.name, "at", newPosition);

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
  } else appLog("Attempted to place, but ARButton reticle not visible.");
}

function onWindowResize() { camera.aspect = window.innerWidth/window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); appLog("Window resized."); }

function animate() { renderer.setAnimationLoop(render); }

function render(timestamp, frame) {
  if (renderer.xr.isPresenting && frame && hitTestSourceRequested && hitTestSource) {
    const referenceSpace = renderer.xr.getReferenceSpace();
    if (referenceSpace) {
        const hitTestResults = frame.getHitTestResults(hitTestSource);
        if(hitTestResults.length){
            if(!planeFound){
                planeFound = true;
                document.getElementById("tracking-prompt").style.display = "none";
                document.getElementById("bottom-controls").style.display = "flex";
                appLog("ARButton: Plane found, controls visible.");
                updateUIForSelection(); // Update UI once controls are visible
            }
            const hit = hitTestResults[0]; const pose = hit.getPose(referenceSpace);
            if(pose){ reticle.visible = true; reticle.matrix.fromArray(pose.transform.matrix); }
            else { reticle.visible = false;}
        } else { reticle.visible = false; }
    }
  } else if (!renderer.xr.isPresenting && planeFound) {
      planeFound = false;
      document.getElementById("tracking-prompt").style.display = "flex";
      document.getElementById("bottom-controls").style.display = "none";
      reticle.visible = false;
      updateUIForSelection(); // Update UI when session ends
  }
  if (renderer.xr.isPresenting && !hitTestSourceRequested && renderer.xr.getSession()) { // Setup hitTestSource if session active
      const session = renderer.xr.getSession();
      session.requestReferenceSpace("viewer").then((viewerRefSpace) => {
        session.requestHitTestSource({ space: viewerRefSpace })
          .then((source) => { hitTestSource = source; appLog("ARButton: Hit test source obtained in render."); })
          .catch(err => appLog("ARButton: Hit test source error in render:", err.message || err));
      }).catch(err => appLog("ARButton: Viewer ref space error in render:", err.message || err));
      hitTestSourceRequested = true; // Prevent re-requesting
  }


  let cameraToRenderWith = findPossibleSDKCamera(scene, camera) || camera;
  renderer.render(scene, cameraToRenderWith);
}

function findPossibleSDKCamera(sceneRef, yourCameraRef) {
    let foundCamera = null;
    sceneRef.traverse(object => {
        if (foundCamera) return;
        if (object.isCamera && object !== yourCameraRef) {
            const name = object.name ? object.name.toLowerCase() : '';
            if (!name.includes("renderer") && !name.includes("default")) {
                foundCamera = object;
            } else if (!object.name) {
                foundCamera = object;
            }
        }
    });
    return foundCamera;
}

function logCameraDebugState(prefix, cam) {
    if (!cam) { appLog(`${prefix} - Camera object is null.`); return; }
    const position = new THREE.Vector3();
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
        currentElement.closest('.action-btn') ||
        currentElement.id === 'ar-button') { // Ignore ARButton itself
      uiTap = true; break;
    }
    currentElement = currentElement.parentElement;
  }

  if (uiTap) { appLog("UI tap ignored."); moving = pinchScaling = pinchRotating = threeFingerMoving = false; return; }

  const xrIsPresenting = renderer.xr.isPresenting;

  if (event.touches.length === 1) {
    if (selectedForManipulationObject) {
        appLog("--- Touch Start (1 finger, object selected) --- Potential Move Start");
        moving = true;
        initialTouchPosition = new THREE.Vector2(event.touches[0].clientX, event.touches[0].clientY);
        if(xrIsPresenting) {
            let camCheck = findPossibleSDKCamera(scene, camera) || camera;
            if(camCheck === camera) renderer.xr.getCamera(camera);
            logCameraDebugState("Ref Cam for Move", camCheck);
        }
        event.preventDefault();
    } else {
        appLog("--- Touch Start (1 finger, NO object selected) ---");
        moving = false;
        // Optionally, if a tap on empty space should deselect any selected object:
        // deselectCurrentObject();
    }
  } else if (event.touches.length === 2 && selectedForManipulationObject) {
    appLog("--- Touch Start (2 fingers, object selected) --- Pinch/Rotate Start");
    moving = false; // Ensure 1-finger move stops
    pinchScaling = true;
    pinchRotating = true; // Allow both simultaneously
    initialPinchDistance = getPinchDistance(event.touches);
    initialTwoFingerAngle = getTwoFingerAngle(event.touches); // Use a different function for angle
    currentScale = selectedForManipulationObject.scale.x; // Store current scale at gesture start
    event.preventDefault();
  } else if (event.touches.length === 3 && selectedForManipulationObject) {
    appLog("--- Touch Start (3 fingers, object selected) --- Z-Move Start");
    moving = pinchScaling = pinchRotating = false;
    threeFingerMoving = true;
    initialZPosition = selectedForManipulationObject.position.y;
    initialThreeFingerY = event.touches[0].clientY; // Use clientY for up/down screen motion
    event.preventDefault();
  } else {
    moving = pinchScaling = pinchRotating = threeFingerMoving = false;
  }
}

function onTouchMove(event) {
  if (!selectedForManipulationObject) return; // No interaction if nothing is selected

  if (moving && event.touches.length === 1 && initialTouchPosition) {
    event.preventDefault();
    const currentTouch = new THREE.Vector2(event.touches[0].clientX, event.touches[0].clientY);
    const dxScreen = currentTouch.x - initialTouchPosition.x;
    const dyScreen = currentTouch.y - initialTouchPosition.y;

    let orientationCamera = camera;
    if (renderer.xr.isPresenting) {
        const sdkCamera = findPossibleSDKCamera(scene, camera);
        if (sdkCamera) {
            const q = new THREE.Quaternion();
            sdkCamera.matrixWorld.decompose(new THREE.Vector3(), q, new THREE.Vector3());
            const isIdentityQuaternion = Math.abs(q.x) < 1e-5 && Math.abs(q.y) < 1e-5 && Math.abs(q.z) < 1e-5 && Math.abs(q.w - 1.0) < 1e-5;
            if (!isIdentityQuaternion) orientationCamera = sdkCamera;
            else renderer.xr.getCamera(camera); // Update main camera if SDK cam is identity
        } else renderer.xr.getCamera(camera); // Update main camera if no SDK cam
    }

    const cameraRight = new THREE.Vector3();
    const cameraFwd = new THREE.Vector3();
    orientationCamera.getWorldDirection(cameraFwd);
    cameraRight.crossVectors(orientationCamera.up, cameraFwd).normalize();
    cameraFwd.y = 0; cameraFwd.normalize();
    cameraRight.y = 0; cameraRight.normalize();
    if (cameraFwd.lengthSq() < 0.0001) cameraFwd.set(0,0,-1);
    if (cameraRight.lengthSq() < 0.0001) cameraRight.set(1,0,0);

    const worldMoveX = cameraRight.multiplyScalar(dxScreen * MOVE_SENSITIVITY);
    const worldMoveZ = cameraFwd.multiplyScalar(dyScreen * MOVE_SENSITIVITY);

    selectedForManipulationObject.position.add(worldMoveX).add(worldMoveZ);
    initialTouchPosition.copy(currentTouch);

  } else if (pinchScaling && event.touches.length === 2) {
    event.preventDefault();
    const newPinchDistance = getPinchDistance(event.touches);
    if (initialPinchDistance > 0) { // Avoid division by zero
        const scaleFactor = newPinchDistance / initialPinchDistance;
        const finalScale = currentScale * scaleFactor;
        selectedForManipulationObject.scale.setScalar(Math.max(0.01, finalScale)); // Prevent zero or negative scale
    }
    if (pinchRotating) {
        const newAngle = getTwoFingerAngle(event.touches);
        const deltaAngle = newAngle - initialTwoFingerAngle;
        selectedForManipulationObject.rotation.y += deltaAngle;
        initialTwoFingerAngle = newAngle; // Update for next frame
    }
  } else if (threeFingerMoving && event.touches.length === 3) {
    event.preventDefault();
    const currentThreeFingerY = event.touches[0].clientY;
    const deltaY = initialThreeFingerY - currentThreeFingerY; // Screen up = object up
    selectedForManipulationObject.position.y = initialZPosition + (deltaY * 0.005); // Adjust sensitivity
  }
}

function onTouchEnd(event) {
  let wasInteracting = moving || pinchScaling || pinchRotating || threeFingerMoving;

  if (moving && (event.touches.length === 0 || !event.touches[0] || event.touches[0].identifier !== initialTouchPosition?.identifier)) { // Check if the specific moving touch ended
    moving = false; initialTouchPosition = null; appLog("--- Touch End (Move) ---");
  }
  if ((pinchScaling || pinchRotating) && event.touches.length < 2) {
    if(selectedForManipulationObject) currentScale = selectedForManipulationObject.scale.x; // Store final scale
    pinchScaling = false; initialPinchDistance = null;
    pinchRotating = false; initialTwoFingerAngle = null;
    appLog("--- Touch End (Pinch/Rotate) ---");
  }
  if (threeFingerMoving && event.touches.length < 3) {
    threeFingerMoving = false; initialZPosition = null; initialThreeFingerY = null;
    appLog("--- Touch End (Z-Move) ---");
  }

  if (event.touches.length === 0) { // All fingers lifted
    moving = pinchScaling = pinchRotating = threeFingerMoving = false;
    initialTouchPosition = null; initialPinchDistance = null; initialTwoFingerAngle = null;
    initialZPosition = null; initialThreeFingerY = null;
    if(wasInteracting) appLog("--- Touch End (All fingers up, interaction ended) ---");
    else appLog("--- Touch End (All fingers up, no interaction active) ---");
  }
}

function getPinchDistance(touches) { return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY); }
function getTwoFingerAngle(touches) { return Math.atan2(touches[1].clientY - touches[0].clientY, touches[1].clientX - touches[0].clientX); }