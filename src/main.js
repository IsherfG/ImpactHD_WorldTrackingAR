import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ARButton } from "three/examples/jsm/webxr/ARButton.js";
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import "./qr.js"; // Assuming these are necessary custom modules
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

// --- UI Helper ---
function updateSelectedObjectButton(selectedId) {
    document.querySelectorAll('.object-btn').forEach(btn => {
        btn.classList.remove('selected');
        if (btn.dataset.objectId === selectedId) btn.classList.add('selected');
    });
}

// --- WebXR Support & Session ---
if ("xr" in navigator) {
  navigator.xr.isSessionSupported("immersive-ar").then((supported) => {
    if (supported) { document.getElementById("ar-not-supported").style.display = "none"; init(); animate(); }
    else {
        const msg = "Immersive AR not supported.";
        document.getElementById("ar-not-supported").innerHTML = msg;
        window.addEventListener('DOMContentLoaded', () => appLog(msg));
    }
  }).catch((err) => {
    const msg = "AR support error:";
    document.getElementById("ar-not-supported").innerHTML = msg + " " + (err.message || err);
    window.addEventListener('DOMContentLoaded', () => appLog(msg, err));
  });
} else {
    const msg = "WebXR API not found.";
    document.getElementById("ar-not-supported").innerHTML = msg;
    window.addEventListener('DOMContentLoaded', () => appLog(msg));
}

function sessionStart() {
  planeFound = false;
  document.getElementById("tracking-prompt").style.display = "flex";
  document.getElementById("bottom-controls").style.display = "none";
  if (selectedForManipulationObject) deselectObject(selectedForManipulationObject);
  document.getElementById("delete-object-btn").style.display = "none";
  if (rayDebugLine) rayDebugLine.visible = false;
  appLog("AR Session Started.");
}

// --- Material Management ---
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

// --- Initialization ---
function init() {
  onScreenLogElement = document.getElementById('on-screen-logger');
  if (!onScreenLogElement) console.error("On-screen logger element not found!");

  container = document.createElement("div"); document.body.appendChild(container);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
  camera.matrixAutoUpdate = false; // CRITICAL for WebXR

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

  const arButton = ARButton.createButton(renderer, {
    requiredFeatures: ["local", "hit-test", "dom-overlay"],
    domOverlay: { root: document.querySelector("#overlay") },
  });
  document.body.appendChild(arButton);

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
  appLog("Initialization complete. Camera matrixAutoUpdate:", camera.matrixAutoUpdate);
}

function onSelect() {
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
      mesh.scale.set(currentScale, currentScale, currentScale);

      const camLookAt = new THREE.Vector3(); camera.getWorldPosition(camLookAt);
      mesh.lookAt(camLookAt.x, mesh.position.y, camLookAt.z);

      scene.add(mesh);
      lastPlacedObject = mesh; allPlacedObjects.push(mesh);
      appLog("Placed object:", mesh.name, "at", newPosition);

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
  } else appLog("Attempted to place object, but reticle not visible.");
}

function onWindowResize() { camera.aspect = window.innerWidth/window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); appLog("Window resized."); }
function animate() { renderer.setAnimationLoop(render); }

function render(timestamp, frame) {
  if (frame) {
    const referenceSpace = renderer.xr.getReferenceSpace(); const session = renderer.xr.getSession();
    if (hitTestSourceRequested === false && session) {
      session.requestReferenceSpace("viewer").then((viewerRefSpace) => {
        session.requestHitTestSource({ space: viewerRefSpace })
          .then((source) => { hitTestSource = source; appLog("Hit test source obtained."); })
          .catch(err => appLog("Hit test source error:", err.message || err));
      }).catch(err => appLog("Viewer ref space error:", err.message || err));
      session.addEventListener("end", () => {
        hitTestSourceRequested = false; hitTestSource = null; planeFound = false;
        document.getElementById("tracking-prompt").style.display = "none";
        document.getElementById("bottom-controls").style.display = "none";
        if (selectedForManipulationObject) deselectObject(selectedForManipulationObject);
        allPlacedObjects.forEach(obj => scene.remove(obj));
        allPlacedObjects = []; originalMaterials.clear(); lastPlacedObject = null;
        currentScale = DEFAULT_OBJECT_SCALE;
        if (rayDebugLine) rayDebugLine.visible = false;
        appLog("AR Session Ended.");
      });
      hitTestSourceRequested = true;
    }
    if (hitTestSource && referenceSpace) {
        const hitTestResults = frame.getHitTestResults(hitTestSource);
        if(hitTestResults.length){
            if(!planeFound){
                planeFound = true;
                document.getElementById("tracking-prompt").style.display = "none";
                document.getElementById("bottom-controls").style.display = "flex";
                appLog("Plane found, controls visible.");
            }
            const hit = hitTestResults[0]; const pose = hit.getPose(referenceSpace);
            if(pose){ reticle.visible = true; reticle.matrix.fromArray(pose.transform.matrix); }
            else { reticle.visible = false;}
        } else { reticle.visible = false; }
    }
  }
  renderer.render(scene, camera);
}

// --- Helper function for logging camera state ---
function logCameraDebugState(prefix, cam) {
    const position = new THREE.Vector3();
    cam.matrixWorld.decompose(position, new THREE.Quaternion(), new THREE.Vector3());
    appLog(`${prefix} - Cam World Pos: X=${position.x.toFixed(2)}, Y=${position.y.toFixed(2)}, Z=${position.z.toFixed(2)}`);
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

    if (renderer.xr.isPresenting) {
        const session = renderer.xr.getSession();
        const referenceSpace = renderer.xr.getReferenceSpace();

        if (!session) appLog("XR Session is NULL during touch!");
        if (!referenceSpace) appLog("XR Reference Space is NULL during touch!");

        if (session && referenceSpace) {
            const xrFrame = renderer.xr.getFrame(); // Three.js's way to get the current XRFrame
            if (xrFrame) {
                const viewerPose = xrFrame.getViewerPose(referenceSpace);
                if (viewerPose) {
                    const p = viewerPose.transform.position;
                    const o = viewerPose.transform.orientation;
                    appLog(`XRFrame ViewerPose: P(x:${p.x.toFixed(2)}, y:${p.y.toFixed(2)}, z:${p.z.toFixed(2)}, w:${p.w.toFixed(2)}) O(x:${o.x.toFixed(2)}, y:${o.y.toFixed(2)}, z:${o.z.toFixed(2)}, w:${o.w.toFixed(2)})`);
                } else {
                    appLog("Could not get viewerPose from XRFrame. Tracking might be lost or session not fully ready.");
                }
            } else {
                appLog("Could not get XRFrame via renderer.xr.getFrame(). This is unexpected in an active session.");
            }
        } else {
            appLog("XR session or referenceSpace not available for direct pose check.");
        }

        renderer.xr.getCamera(camera); // This SHOULD update camera.matrixWorld
        logCameraDebugState("After renderer.xr.getCamera", camera);

    } else {
        appLog("Not in XR presenting mode during onTouchStart.");
    }

    raycaster.setFromCamera(tapPosition, camera);
    appLog(`Ray Origin: X=${raycaster.ray.origin.x.toFixed(2)}, Y=${raycaster.ray.origin.y.toFixed(2)}, Z=${raycaster.ray.origin.z.toFixed(2)}`);

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
          appLog("Tapped object:", tappedObjectRoot.name || "Unnamed Object", "Dist:", intersects[0].distance.toFixed(2));
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
    const cameraRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0); cameraRight.y=0; cameraRight.normalize();
    const cameraForward = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2); cameraForward.negate(); cameraForward.y=0; cameraForward.normalize();
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