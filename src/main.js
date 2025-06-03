import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ARButton } from "three/examples/jsm/webxr/ARButton.js";
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import "./qr.js"; // Assuming this is needed by Variant Launch or your setup
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
let currentScale = DEFAULT_OBJECT_SCALE; // Stores scale of the currently selected object
let lastPlacedObject = null; // Keep for reference if needed, but selection is primary
let allPlacedObjects = [];
let selectedForManipulationObject = null;
let originalMaterials = new Map();
const SELECTION_COLOR = 0xffaa00; // Orange-yellow for selection highlight

const MOVE_SENSITIVITY = 0.002; // For 1-finger object dragging
const HDR_ENVIRONMENT_MAP_PATH = 'hdr.hdr';

// Touch gesture state variables
let initialPinchDistance = null, pinchScaling = false;
let initialPinchAngle = null, pinchRotating = false;
let moving = false, initialTouchPosition = null;
let threeFingerMoving = false, initialZPosition = null, initialThreeFingerY = null;

const raycaster = new THREE.Raycaster(); // Still used by ARButton, but not for object selection
const tapPosition = new THREE.Vector2(); // For ARButton interaction if used for placement
// let rayDebugLine = null; // Removed as raycasting for selection is gone

let selectedObject = "obj1"; // For object type selection from pallet
let lastFoundSDKCamera = null;

// UI elements for cycling selection
let prevObjectBtn, nextObjectBtn, deleteObjectBtn;

// --- UI Helper ---
function updateSelectedObjectButton(selectedId) {
    document.querySelectorAll('.object-btn').forEach(btn => {
        btn.classList.remove('selected');
        if (btn.dataset.objectId === selectedId) btn.classList.add('selected');
    });
}

function updateCycleButtonVisibility() {
    const hasMultipleObjects = allPlacedObjects.length > 1;
    const hasAnyObjects = allPlacedObjects.length > 0;

    if (prevObjectBtn) prevObjectBtn.style.display = hasMultipleObjects ? "flex" : "none";
    if (nextObjectBtn) nextObjectBtn.style.display = hasMultipleObjects ? "flex" : "none";
    
    // Delete button visibility is handled by selectObject/deselectObject based on selectedForManipulationObject
    if (deleteObjectBtn) deleteObjectBtn.style.display = selectedForManipulationObject ? "flex" : "none";
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

function sessionStart() {
  planeFound = false;
  document.getElementById("tracking-prompt").style.display = "flex";
  document.getElementById("bottom-controls").style.display = "none";
  if (selectedForManipulationObject) deselectObject(); // Deselect current if any
  // if (rayDebugLine) rayDebugLine.visible = false; // Ray debug line removed
  appLog("ARButton: XR Session Started (if ARButton was used).");
}

// --- Material Management ---
function storeOriginalMaterials(object) {
    if (originalMaterials.has(object)) return;
    const materialsToStore = [];
    object.traverse(child => {
        if (child.isMesh && child.material) {
            const matClone = child.material.clone();
            matClone.userData = { isOriginal: true }; // Mark as original
            materialsToStore.push({ mesh: child, material: matClone });
        }
    });
    originalMaterials.set(object, materialsToStore);
}

function restoreOriginalMaterials(object) {
    if (originalMaterials.has(object)) {
        const materialsInfo = originalMaterials.get(object);
        materialsInfo.forEach(info => {
            // Only dispose if the current material is not the stored original one
            if (info.mesh.material !== info.material && !info.mesh.material.userData?.isOriginal) {
                info.mesh.material.dispose();
            }
            info.mesh.material = info.material;
        });
    }
}

function highlightSelectedObject(object) {
    storeOriginalMaterials(object); // Ensure original materials are stored
    object.traverse(child => {
        if (child.isMesh && child.material) {
            const originalChildMaterial = originalMaterials.get(object)?.find(m => m.mesh === child)?.material;
            
            // Dispose existing non-original material before assigning new highlight material
            if (child.material !== originalChildMaterial && !child.material.userData?.isOriginal) {
                 child.material.dispose();
            }

            const highlightMaterial = new THREE.MeshStandardMaterial({
                color: SELECTION_COLOR,
                emissive: SELECTION_COLOR,
                emissiveIntensity: 0.4,
                map: originalChildMaterial?.map || null, // Preserve texture if available
                // Add other properties from original material if needed (e.g., roughness, metalness)
            });
            child.material = highlightMaterial;
        }
    });
}

function selectObject(objectToSelect) {
    if (selectedForManipulationObject === objectToSelect) return; 

    if (selectedForManipulationObject) {
        deselectObject(); // Deselect current object
    }

    selectedForManipulationObject = objectToSelect;
    if (selectedForManipulationObject) {
        highlightSelectedObject(selectedForManipulationObject);
        currentScale = selectedForManipulationObject.scale.x; 
        appLog("Selected for manipulation:", selectedForManipulationObject.name || "Unnamed Object");
    }
    updateCycleButtonVisibility();
}

function deselectObject() { // Always deselects the CURRENTLY selected object
    if (selectedForManipulationObject) {
        restoreOriginalMaterials(selectedForManipulationObject);
        appLog("Deselected:", selectedForManipulationObject.name || "Unnamed Object");
        selectedForManipulationObject = null;
    }
    updateCycleButtonVisibility();
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
      arButton.id = 'ar-button';
      document.body.appendChild(arButton);
      appLog("ARButton created and added to body.");
  }

  new RGBELoader().setPath('').load(HDR_ENVIRONMENT_MAP_PATH, (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping; scene.environment = texture;
    appLog(`Env map '${HDR_ENVIRONMENT_MAP_PATH}' loaded.`);
  }, undefined, (err) => appLog(`HDR Load Error for '${HDR_ENVIRONMENT_MAP_PATH}':`, err.message || err));

  // Get button references
  prevObjectBtn = document.getElementById("prev-object-btn");
  nextObjectBtn = document.getElementById("next-object-btn");
  deleteObjectBtn = document.getElementById("delete-object-btn");

  document.getElementById("place-object-btn").addEventListener("click", onPlaceObject); // Renamed for clarity
  deleteObjectBtn.addEventListener("click", () => {
    if (selectedForManipulationObject) {
        const objectToDelete = selectedForManipulationObject;
        const objectName = objectToDelete.name || "Unnamed Object";
        const deletedIndex = allPlacedObjects.indexOf(objectToDelete);

        deselectObject(); // Deselects current, hides delete btn, restores material

        scene.remove(objectToDelete);
        allPlacedObjects = allPlacedObjects.filter(obj => obj !== objectToDelete);
        originalMaterials.delete(objectToDelete); // Clean up stored materials for this object

        objectToDelete.traverse(child => {
            if (child.isMesh) {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if(Array.isArray(child.material)) child.material.forEach(mat => { if(mat.map) mat.map.dispose(); mat.dispose(); });
                    else { if(child.material.map) child.material.map.dispose(); child.material.dispose(); }
                }
            }
        });
        appLog("Object deleted:", objectName);

        if (allPlacedObjects.length > 0) {
            const newIndexToSelect = Math.min(deletedIndex, allPlacedObjects.length - 1);
            selectObject(allPlacedObjects[newIndexToSelect]);
        }
        // updateCycleButtonVisibility is called by deselectObject and potentially selectObject
    }
  });

  prevObjectBtn.addEventListener("click", () => selectCycle('prev'));
  nextObjectBtn.addEventListener("click", () => selectCycle('next'));

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
  
  updateCycleButtonVisibility(); // Initial call
  appLog("Initialization complete. Main camera matrixAutoUpdate:", camera.matrixAutoUpdate);
}

function selectCycle(direction) { // direction is 'next' or 'prev'
    if (allPlacedObjects.length === 0) {
        if (selectedForManipulationObject) deselectObject();
        return;
    }
    if (allPlacedObjects.length === 1) {
        // If only one object, select it if not already selected. No actual "cycling".
        if (selectedForManipulationObject !== allPlacedObjects[0]) {
            selectObject(allPlacedObjects[0]);
        }
        return;
    }

    let currentIndex = -1;
    if (selectedForManipulationObject) {
        currentIndex = allPlacedObjects.indexOf(selectedForManipulationObject);
    }

    let newIndex;
    if (direction === 'next') {
        newIndex = (currentIndex + 1) % allPlacedObjects.length;
    } else { // prev
        newIndex = (currentIndex - 1 + allPlacedObjects.length) % allPlacedObjects.length;
    }
    
    selectObject(allPlacedObjects[newIndex]);
}


function onPlaceObject() { // Renamed from onSelect
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
      
      // Use the default scale for new objects, not currentScale of a selected one
      mesh.scale.set(DEFAULT_OBJECT_SCALE, DEFAULT_OBJECT_SCALE, DEFAULT_OBJECT_SCALE);

      let activeCamera = findPossibleSDKCamera(scene, camera) || camera;
      const camLookAt = new THREE.Vector3();
      activeCamera.getWorldPosition(camLookAt); // Get camera's world position
      mesh.lookAt(camLookAt.x, mesh.position.y, camLookAt.z); // Look at camera on Y plane

      scene.add(mesh);
      lastPlacedObject = mesh; 
      allPlacedObjects.push(mesh);
      appLog("Placed object:", mesh.name, "at", newPosition);

      selectObject(mesh); // Automatically select the newly placed object

      const targetScaleVal = mesh.scale.x; 
      mesh.scale.setScalar(targetScaleVal * 0.1); // Start smaller for animation
      const animStartTime = performance.now();
      function animateEntry() {
        if (!mesh.parent) return; // Stop if removed
        const elapsed = performance.now() - animStartTime;
        if (elapsed >= 300) { mesh.scale.setScalar(targetScaleVal); return; }
        const progress = 1 - Math.pow(1 - (elapsed / 300), 3); // Ease-out cubic
        mesh.scale.setScalar(targetScaleVal * 0.1 + targetScaleVal * 0.9 * progress);
        requestAnimationFrame(animateEntry);
      }
      requestAnimationFrame(animateEntry);
    } else appLog("Model to clone not found for ID:", selectedObject);
  } else appLog("Attempted to place, but ARButton reticle not visible.");
}

function onWindowResize() { camera.aspect = window.innerWidth/window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); appLog("Window resized."); }

function animate() {
  renderer.setAnimationLoop(render);
}

function render(timestamp, frame) {
  if (renderer.xr.isPresenting && frame && hitTestSourceRequested) {
    const referenceSpace = renderer.xr.getReferenceSpace();
    if (hitTestSource && referenceSpace) {
        const hitTestResults = frame.getHitTestResults(hitTestSource);
        if(hitTestResults.length){
            if(!planeFound){ 
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
  } else if (!renderer.xr.isPresenting && planeFound) {
      planeFound = false;
      document.getElementById("tracking-prompt").style.display = "flex";
      document.getElementById("bottom-controls").style.display = "none";
      reticle.visible = false;
  }

  let cameraToRenderWith = camera;
  if (renderer.xr.isPresenting) {
      const sdkCam = findPossibleSDKCamera(scene, camera);
      if (sdkCam) {
          cameraToRenderWith = sdkCam;
      }
  }
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
    if (!cam) {
        appLog(`${prefix} - Camera object is null.`);
        return;
    }
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
        currentElement.closest('.object-btn') || // Check for any object selection button
        currentElement.closest('.action-btn')) { // Check for any action button
      uiTap = true; break;
    }
    currentElement = currentElement.parentElement;
  }

  if (uiTap) { appLog("UI tap ignored for gestures."); moving = pinchScaling = pinchRotating = threeFingerMoving = false; return; }

  // Log camera state for debugging movement context, even if not raycasting for selection
  const xrIsPresenting = renderer.xr.isPresenting;
  appLog(`--- Touch Start (Gestures) --- XR Presenting: ${xrIsPresenting}`);
  if (xrIsPresenting) {
      const sdkCamera = findPossibleSDKCamera(scene, camera);
      if (sdkCamera) {
          if (lastFoundSDKCamera !== sdkCamera) {
              appLog("Found SDK camera:", sdkCamera.name || 'UnnamedSDKCam', `UUID: ${sdkCamera.uuid.substring(0,8)}`);
              lastFoundSDKCamera = sdkCamera;
          }
          logCameraDebugState("SDK Camera State (for gesture context)", sdkCamera);
      } else {
          appLog("No other camera found. Using 'MyMainCamera' for gesture context.");
          if (lastFoundSDKCamera) { lastFoundSDKCamera = null; }
          logCameraDebugState("MyMainCamera State (before xr.getCamera, for gesture context)", camera);
          renderer.xr.getCamera(camera); // Update 'MyMainCamera' from XR session
          logCameraDebugState("MyMainCamera State (after xr.getCamera, for gesture context)", camera);
      }
  } else {
    appLog("Not in XR. Using 'MyMainCamera' for gesture context.");
  }


  // Single touch: initiate movement if an object is ALREADY selected
  if (event.touches.length === 1 && selectedForManipulationObject) {
    appLog("1-finger touch with object selected. Initiating move for:", selectedForManipulationObject.name);
    moving = true;
    initialTouchPosition = new THREE.Vector2(event.touches[0].pageX, event.touches[0].pageY);
    pinchScaling = pinchRotating = threeFingerMoving = false; // Reset other modes
    return; // Important: prevent fall-through to multi-touch logic
  }

  // If no object selected, or more than one touch, proceed to multi-touch gestures for the selected object
  if (!selectedForManipulationObject) {
    moving = pinchScaling = pinchRotating = threeFingerMoving = false;
    appLog("Touch start, but no object selected for manipulation. Gestures N/A.");
    return; // No selected object, so multi-touch gestures don't apply
  }

  // Multi-touch gestures (these implicitly operate on selectedForManipulationObject)
  if (event.touches.length === 3) {
    appLog("3-finger touch start for Z move on:", selectedForManipulationObject.name);
    threeFingerMoving = true;
    initialZPosition = selectedForManipulationObject.position.y;
    initialThreeFingerY = event.touches[0].pageY;
    pinchScaling = pinchRotating = moving = false; // Ensure other modes are off
  } else if (event.touches.length === 2) {
    appLog("2-finger touch start for scale/rotate on:", selectedForManipulationObject.name);
    pinchScaling = true;
    pinchRotating = true; 
    initialPinchDistance = getPinchDistance(event.touches);
    initialPinchAngle = getPinchAngle(event.touches);
    moving = threeFingerMoving = false; // Ensure other modes are off
  }
}

function onTouchMove(event) {
  if (!selectedForManipulationObject && !moving && !pinchScaling && !threeFingerMoving) return; // Guard

  if (threeFingerMoving && event.touches.length === 3 && selectedForManipulationObject) {
    const deltaY = initialThreeFingerY - event.touches[0].pageY; // Inverted for natural up/down
    selectedForManipulationObject.position.y = initialZPosition + (deltaY * 0.005); // Sensitivity
  } else if (pinchScaling && event.touches.length === 2 && selectedForManipulationObject) {
    const newPinchDistance = getPinchDistance(event.touches);
    if (initialPinchDistance === null || initialPinchDistance === 0) { initialPinchDistance = newPinchDistance; return; }
    const scaleChange = newPinchDistance / initialPinchDistance;
    const newObjectScale = currentScale * scaleChange; // Scale relative to original scale at pinch start
    selectedForManipulationObject.scale.set(newObjectScale, newObjectScale, newObjectScale);
    
    if (pinchRotating) { // Assuming pinchRotating is true if pinchScaling is true
      const newPinchAngle = getPinchAngle(event.touches);
      if (initialPinchAngle === null) { initialPinchAngle = newPinchAngle; return; }
      selectedForManipulationObject.rotation.y += (newPinchAngle - initialPinchAngle); // Apply delta angle
      initialPinchAngle = newPinchAngle; // Update for next frame
    }
  } else if (moving && event.touches.length === 1 && selectedForManipulationObject) {
    if (initialTouchPosition === null) { initialTouchPosition = new THREE.Vector2(event.touches[0].pageX, event.touches[0].pageY); return; }
    const currentTouch = new THREE.Vector2(event.touches[0].pageX, event.touches[0].pageY);
    const dxScreen = currentTouch.x - initialTouchPosition.x;
    const dyScreen = currentTouch.y - initialTouchPosition.y;
    
    let activeCamera = camera; 
    if(renderer.xr.isPresenting){
        const sdkCam = findPossibleSDKCamera(scene, camera);
        if(sdkCam) activeCamera = sdkCam;
        else { 
            renderer.xr.getCamera(camera); 
            activeCamera = camera;
        }
    }

    // Get camera's right and forward vectors, projected onto XZ plane
    const cameraRight = new THREE.Vector3().setFromMatrixColumn(activeCamera.matrixWorld, 0); 
    cameraRight.y=0; cameraRight.normalize();
    const cameraForward = new THREE.Vector3().setFromMatrixColumn(activeCamera.matrixWorld, 2); 
    cameraForward.negate(); // Forward is -Z
    cameraForward.y=0; cameraForward.normalize();
    
    const worldMoveX = cameraRight.clone().multiplyScalar(dxScreen * MOVE_SENSITIVITY);
    const worldMoveZ = cameraForward.clone().multiplyScalar(dyScreen * MOVE_SENSITIVITY); // dyScreen for Z movement
    
    selectedForManipulationObject.position.add(worldMoveX).add(worldMoveZ);
    initialTouchPosition.copy(currentTouch);
  }
}

function onTouchEnd(event) {
  if (threeFingerMoving && event.touches.length < 3) { 
      threeFingerMoving = false; initialZPosition = null; initialThreeFingerY = null; 
      appLog("3-finger Z move end.");
    }
  if ((pinchScaling || pinchRotating) && event.touches.length < 2) {
    if (selectedForManipulationObject) { 
        currentScale = selectedForManipulationObject.scale.x; // Update currentScale for next pinch
        appLog("2-finger scale/rotate end. New currentScale:", currentScale.toFixed(3));
    }
    pinchScaling = false; pinchRotating = false; initialPinchDistance = null; initialPinchAngle = null;
  }
  if (moving && event.touches.length < 1) { 
      moving = false; initialTouchPosition = null; 
      appLog("1-finger move end.");
    }

  // If all touches are up, reset all gesture states comprehensively
  if (event.touches.length === 0) {
    threeFingerMoving = pinchScaling = pinchRotating = moving = false;
    initialPinchDistance = null; initialPinchAngle = null; initialTouchPosition = null; 
    initialZPosition = null; initialThreeFingerY = null;
    appLog("--- Touch End (all fingers up), gestures reset ---");
  } else {
    appLog(`--- Touch End (fingers left: ${event.touches.length}) ---`);
  }
}

function getPinchDistance(touches) { return Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY); }
function getPinchAngle(touches) { return Math.atan2(touches[0].pageY - touches[1].pageY, touches[0].pageX - touches[1].pageX); }