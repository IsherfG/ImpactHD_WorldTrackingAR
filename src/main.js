import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ARButton } from "three/examples/jsm/webxr/ARButton.js";
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import "./qr.js"; // Assuming this is part of your setup
import "./style.css"; // Make sure this is linked

// --- Global Variables ---
let container;
let camera, scene, renderer;
let controller;
let reticle;

// GLTF model references
let object1, object2, object3, object4, object5;

// WebXR AR specific variables
let hitTestSource = null;
let hitTestSourceRequested = false;
let planeFound = false;

// Object scale and selection variables
const DEFAULT_OBJECT_SCALE = 0.2;
let currentScale = DEFAULT_OBJECT_SCALE; // Used for new object placements, updated on pinch end.
let lastPlacedObject = null;             // Tracks the very last object added to the scene.
let allPlacedObjects = [];               // Array to store all placed objects for raycasting.
let selectedForManipulationObject = null; // The object currently selected by tap for gestures.
let originalMaterials = new Map();       // Stores original materials of selected object for restoration.

// Constants for interaction
const SELECTION_COLOR = 0xffaa00; // Bright orange/yellow for selection highlight.
const MOVE_SENSITIVITY = 0.002;   // Sensitivity for 1-finger drag.
const HDR_ENVIRONMENT_MAP_PATH = 'hdr.hdr'; // !!! REPLACE WITH YOUR ACTUAL HDR PATH !!!

// Touch gesture state variables
let initialPinchDistance = null, pinchScaling = false;
let initialPinchAngle = null, pinchRotating = false;
let moving = false, initialTouchPosition = null;
let threeFingerMoving = false, initialZPosition = null, initialThreeFingerY = null;

// Raycasting tools for object selection
const raycaster = new THREE.Raycaster();
const tapPosition = new THREE.Vector2();

// --- UI Helper ---
function updateSelectedObjectButton(selectedId) {
    document.querySelectorAll('.object-btn').forEach(btn => {
        btn.classList.remove('selected');
        if (btn.dataset.objectId === selectedId) {
            btn.classList.add('selected');
        }
    });
}
let selectedObject = "obj1"; // Default object type to place

// --- WebXR Support Check & Initialization ---
if ("xr" in navigator) {
  navigator.xr.isSessionSupported("immersive-ar").then((supported) => {
    if (supported) {
      document.getElementById("ar-not-supported").style.display = "none";
      init();
      animate();
    } else {
      document.getElementById("ar-not-supported").innerHTML = "Immersive AR not supported. Try on a compatible mobile device.";
      // Optionally hide AR button if not supported
      const arButtonElement = document.querySelector("#ARButton") || document.querySelector(".ar-button"); // Try common selectors
      if (arButtonElement) arButtonElement.style.display = "none";
    }
  }).catch((err) => {
    console.error("AR support check error:", err);
    document.getElementById("ar-not-supported").innerHTML = "Error checking AR support.";
  });
} else {
  document.getElementById("ar-not-supported").innerHTML = "WebXR API not found. Try a modern browser.";
}

// --- AR Session Lifecycle Callbacks ---
function sessionStart() {
  planeFound = false;
  document.getElementById("tracking-prompt").style.display = "flex";
  document.getElementById("bottom-controls").style.display = "none";
  if (selectedForManipulationObject) { // Deselect any object if session restarts
      deselectObject(selectedForManipulationObject);
  }
  document.getElementById("delete-object-btn").style.display = "none";
}

// --- Material Management for Selection Highlighting ---
function storeOriginalMaterials(object) {
    if (originalMaterials.has(object)) return; // Already stored
    const materialsToStore = [];
    object.traverse(child => {
        if (child.isMesh && child.material) {
            // Store a clone of the material to revert to.
            materialsToStore.push({ mesh: child, material: child.material.clone() });
        }
    });
    originalMaterials.set(object, materialsToStore);
}

function restoreOriginalMaterials(object) {
    if (originalMaterials.has(object)) {
        const materialsInfo = originalMaterials.get(object);
        materialsInfo.forEach(info => {
            // Dispose the highlight material if it's not the original we stored
            if (info.mesh.material !== info.material && !info.mesh.material.userData?.isOriginal) {
                info.mesh.material.dispose();
            }
            info.mesh.material = info.material; // Assign back the cloned original
        });
        // Note: We don't delete from `originalMaterials` here, as the object might be re-selected.
        // It should be cleared when the object is permanently removed from the scene.
    }
}

function highlightSelectedObject(object) {
    storeOriginalMaterials(object); // Ensure originals are stored before applying highlight.

    object.traverse(child => {
        if (child.isMesh && child.material) {
            // Find this child's specific original material to reference its properties (like map)
            const originalChildMaterial = originalMaterials.get(object)?.find(m => m.mesh === child)?.material;

            // Dispose previous highlight material if it existed and wasn't an original
            // (This check helps prevent disposing the actual original material if logic gets complex)
            if (child.material !== originalChildMaterial && !child.material.userData?.isOriginal) {
                 child.material.dispose();
            }

            const highlightMaterial = new THREE.MeshStandardMaterial({
                color: SELECTION_COLOR,
                emissive: SELECTION_COLOR, // Add a slight glow
                emissiveIntensity: 0.4,   // Intensity of the glow
                map: originalChildMaterial?.map || null, // Preserve original texture
                // You might want to preserve other properties too, or simplify the highlight
                // roughness: originalChildMaterial?.roughness !== undefined ? originalChildMaterial.roughness : 0.7,
                // metalness: originalChildMaterial?.metalness !== undefined ? originalChildMaterial.metalness : 0.1,
            });
            child.material = highlightMaterial;
        }
    });
}

function selectObject(object) {
    if (selectedForManipulationObject === object) return; // Already selected, do nothing.

    if (selectedForManipulationObject) { // If another object was selected, deselect it first.
        deselectObject(selectedForManipulationObject);
    }
    selectedForManipulationObject = object;
    highlightSelectedObject(object);
    document.getElementById("delete-object-btn").style.display = "flex"; // Show delete button
    // Update currentScale for pinch gestures to be relative to this newly selected object's scale.
    currentScale = selectedForManipulationObject.scale.x;
}

function deselectObject(object) {
    if (!object) return; // No object to deselect.
    restoreOriginalMaterials(object);
    if (selectedForManipulationObject === object) { // If this was the currently selected object.
        selectedForManipulationObject = null;
        document.getElementById("delete-object-btn").style.display = "none"; // Hide delete button.
    }
}

// --- Main Initialization Function ---
function init() {
  container = document.createElement("div");
  document.body.appendChild(container);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

  // Lighting Setup
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 0.6);
  hemiLight.position.set(0.5, 1, 0.25);
  scene.add(hemiLight);
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambientLight);
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(1.5, 2, 1).normalize();
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 1024;
  directionalLight.shadow.mapSize.height = 1024;
  directionalLight.shadow.camera.near = 0.1;
  directionalLight.shadow.camera.far = 10;
  directionalLight.shadow.camera.left = -2; directionalLight.shadow.camera.right = 2;
  directionalLight.shadow.camera.top = 2; directionalLight.shadow.camera.bottom = -2;
  directionalLight.shadow.bias = -0.001;
  scene.add(directionalLight);

  // Renderer Setup
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

  // Environment Map Loading
  new RGBELoader()
    .setPath('') // Adjust path if HDR is in a subfolder like 'assets/'
    .load(HDR_ENVIRONMENT_MAP_PATH, function (texture) {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      scene.environment = texture;
      console.log("Environment map '" + HDR_ENVIRONMENT_MAP_PATH + "' loaded.");
    }, undefined, function(error) {
        console.error(`Could not load HDR environment map from '${HDR_ENVIRONMENT_MAP_PATH}':`, error);
    });

  // AR Button Setup
  const arButton = ARButton.createButton(renderer, {
    requiredFeatures: ["local", "hit-test", "dom-overlay"],
    domOverlay: { root: document.querySelector("#overlay") },
  });
  document.body.appendChild(arButton);

  // UI Event Listeners
  document.getElementById("place-object-btn").addEventListener("click", onSelect);
  document.getElementById("delete-object-btn").addEventListener("click", () => {
    if (selectedForManipulationObject) {
      scene.remove(selectedForManipulationObject);
      allPlacedObjects = allPlacedObjects.filter(obj => obj !== selectedForManipulationObject);
      originalMaterials.delete(selectedForManipulationObject); // Clean up its stored materials.
      // Basic disposal of geometry/material for the removed object
      selectedForManipulationObject.traverse(child => {
        if (child.isMesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) child.material.forEach(mat => { if(mat.map) mat.map.dispose(); mat.dispose(); });
            else { if(child.material.map) child.material.map.dispose(); child.material.dispose(); }
          }
        }
      });
      selectedForManipulationObject = null;
      document.getElementById("delete-object-btn").style.display = "none";
    }
  });

  document.querySelectorAll('.object-btn').forEach(button => {
    button.addEventListener('click', (event) => {
        event.stopPropagation();
        selectedObject = button.dataset.objectId; // This is for choosing *which type* to place next
        updateSelectedObjectButton(selectedObject);
    });
  });
  // Set initial UI selection for object type
  const firstObjectButton = document.querySelector('.object-btn');
  if (firstObjectButton) {
      selectedObject = firstObjectButton.dataset.objectId;
      updateSelectedObjectButton(selectedObject);
  }

  // Reticle Setup
  reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.075, 0.1, 24).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, side: THREE.DoubleSide })
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  // GLTF and Texture Loading
  const gltfLoader = new GLTFLoader();
  const textureLoader = new THREE.TextureLoader();
  const loadErrorCallback = (name) => (error) => console.error(`Error loading ${name}:`, error);

  // Helper to apply texture to GLTF, ensuring MeshStandardMaterial
  function applyTextureToGLTF(gltfScene, texture) {
    gltfScene.traverse(node => {
        if (node.isMesh) {
            let newMaterial;
            if (node.material && node.material.isMeshStandardMaterial) {
                newMaterial = node.material.clone();
            } else {
                newMaterial = new THREE.MeshStandardMaterial();
                if (node.material && node.material.color) newMaterial.color.copy(node.material.color);
            }
            newMaterial.map = texture;
            newMaterial.needsUpdate = true;
            node.material = newMaterial;
        }
    });
  }

  gltfLoader.load("Shelf.glb", (gltf) => { object1 = gltf.scene; }, undefined, loadErrorCallback("Shelf.glb"));
  textureLoader.load("Shelf.png", (texture) => {
    texture.flipY = false; texture.encoding = THREE.sRGBEncoding;
    gltfLoader.load("Shelf2.glb", (gltf) => { object2 = gltf.scene; applyTextureToGLTF(object2, texture);}, undefined, loadErrorCallback("Shelf2.glb"));
  }, undefined, loadErrorCallback("Shelf.png"));
  textureLoader.load("Map1.png", (texture) => {
    texture.flipY = false; texture.encoding = THREE.sRGBEncoding;
    gltfLoader.load("Bag1.glb", (gltf) => { object3 = gltf.scene; applyTextureToGLTF(object3, texture);}, undefined, loadErrorCallback("Bag1.glb"));
  }, undefined, loadErrorCallback("Map1.png"));
  textureLoader.load("Map2.jpg", (texture) => {
    texture.flipY = false; texture.encoding = THREE.sRGBEncoding;
    gltfLoader.load("Bag2.glb", (gltf) => { object4 = gltf.scene; applyTextureToGLTF(object4, texture);}, undefined, loadErrorCallback("Bag2.glb"));
  }, undefined, loadErrorCallback("Map2.jpg"));
  textureLoader.load("Map3.png", (texture) => {
    texture.flipY = false; texture.encoding = THREE.sRGBEncoding;
    gltfLoader.load("Bag3.glb", (gltf) => { object5 = gltf.scene; applyTextureToGLTF(object5, texture);}, undefined, loadErrorCallback("Bag3.glb"));
  }, undefined, loadErrorCallback("Map3.png"));

  // Global Event Listeners
  window.addEventListener("resize", onWindowResize);
  window.addEventListener("touchstart", onTouchStart, { passive: false });
  window.addEventListener("touchmove", onTouchMove, { passive: false });
  window.addEventListener("touchend", onTouchEnd, false);
}

// --- Object Placement Function ---
function onSelect() {
  if (reticle.visible) {
    let modelToClone; // Determine which model to place based on UI selection (selectedObject)
    if (selectedObject === "obj1" && object1) modelToClone = object1;
    else if (selectedObject === "obj2" && object2) modelToClone = object2;
    else if (selectedObject === "obj3" && object3) modelToClone = object3;
    else if (selectedObject === "obj4" && object4) modelToClone = object4;
    else if (selectedObject === "obj5" && object5) modelToClone = object5;

    if (modelToClone) {
      const mesh = modelToClone.clone();
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.traverse(child => { if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; }});

      const newPosition = new THREE.Vector3();
      const newQuaternion = new THREE.Quaternion();
      reticle.matrix.decompose(newPosition, newQuaternion, new THREE.Vector3()); // Temp vec for scale
      mesh.position.copy(newPosition);
      mesh.quaternion.copy(newQuaternion);
      // For new objects, use the global currentScale (which might have been set by a previous pinch)
      // Or, if you want all new objects to start at default: use DEFAULT_OBJECT_SCALE
      mesh.scale.set(currentScale, currentScale, currentScale);

      const cameraLookAt = new THREE.Vector3();
      camera.getWorldPosition(cameraLookAt);
      mesh.lookAt(cameraLookAt.x, mesh.position.y, cameraLookAt.z);

      scene.add(mesh);
      lastPlacedObject = mesh;       // Update the last physically placed object
      allPlacedObjects.push(mesh); // Add to the list of all interactable objects

      // Automatically select the newly placed object for manipulation
      if (selectedForManipulationObject && selectedForManipulationObject !== mesh) {
        deselectObject(selectedForManipulationObject); // Deselect any previously selected object
      }
      selectObject(mesh); // This will highlight it and show delete button

      // Entry Animation
      const targetScaleVal = mesh.scale.x; // Animate to its current scale
      mesh.scale.setScalar(targetScaleVal * 0.1); // Start small
      const animStartTime = performance.now();
      function animateEntry() {
        if (!mesh.parent) return; // Stop if removed during animation
        const elapsed = performance.now() - animStartTime;
        if (elapsed >= 300) { // Animation duration 300ms
          mesh.scale.setScalar(targetScaleVal);
          return;
        }
        const progress = 1 - Math.pow(1 - (elapsed / 300), 3); // Ease-out cubic
        mesh.scale.setScalar(targetScaleVal * 0.1 + targetScaleVal * 0.9 * progress);
        requestAnimationFrame(animateEntry);
      }
      requestAnimationFrame(animateEntry);
    }
  }
}

// --- Window Resize Handler ---
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- Animation Loop Starter ---
function animate() {
  renderer.setAnimationLoop(render);
}

// --- Render Loop ---
function render(timestamp, frame) {
  if (frame) {
    const referenceSpace = renderer.xr.getReferenceSpace();
    const session = renderer.xr.getSession();

    if (hitTestSourceRequested === false && session) {
      session.requestReferenceSpace("viewer").then((viewerRefSpace) => {
        session.requestHitTestSource({ space: viewerRefSpace })
          .then((source) => { hitTestSource = source; })
          .catch(err => console.error("Hit test source error:", err));
      }).catch(err => console.error("Viewer ref space error:", err));

      session.addEventListener("end", () => { // Cleanup on session end
        hitTestSourceRequested = false; hitTestSource = null; planeFound = false;
        document.getElementById("tracking-prompt").style.display = "none";
        document.getElementById("bottom-controls").style.display = "none";
        if (selectedForManipulationObject) deselectObject(selectedForManipulationObject);
        allPlacedObjects.forEach(obj => scene.remove(obj)); // Remove all placed objects
        allPlacedObjects = [];
        originalMaterials.clear(); // Clear stored materials
        lastPlacedObject = null;
        currentScale = DEFAULT_OBJECT_SCALE;
      });
      hitTestSourceRequested = true;
    }

    if (hitTestSource && referenceSpace) { // Reticle and UI updates based on hit-test
      const hitTestResults = frame.getHitTestResults(hitTestSource);
      if (hitTestResults.length) {
        if (!planeFound) {
          planeFound = true;
          document.getElementById("tracking-prompt").style.display = "none";
          document.getElementById("bottom-controls").style.display = "flex";
        }
        const hit = hitTestResults[0];
        const pose = hit.getPose(referenceSpace);
        if (pose) { reticle.visible = true; reticle.matrix.fromArray(pose.transform.matrix); }
        else { reticle.visible = false; }
      } else { reticle.visible = false; }
    }
  }
  renderer.render(scene, camera);
}

// --- Touch Event Handlers ---
function onTouchStart(event) {
  let targetElement = event.target; let uiTap = false;
  // Check if the touch originated on a UI element that should prevent object interaction
  while(targetElement && targetElement !== document.body) {
    if ((targetElement.dataset?.ignoreTap === 'true') ||
        targetElement.closest('#object-selector') || // Check if tap is within object selector
        targetElement.closest('#action-buttons')) { // Check if tap is within action buttons
        uiTap = true; break;
    }
    targetElement = targetElement.parentElement;
  }

  if (uiTap) { // If tap is on UI, reset gesture flags and do nothing more for 3D interaction
    moving = pinchScaling = pinchRotating = threeFingerMoving = false;
    return;
  }

  // --- Object Selection Logic (1-finger tap) ---
  if (event.touches.length === 1) {
    tapPosition.x = (event.touches[0].clientX / window.innerWidth) * 2 - 1;
    tapPosition.y = -(event.touches[0].clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(tapPosition, camera);
    const intersects = raycaster.intersectObjects(allPlacedObjects, true); // Raycast against all placed objects

    if (intersects.length > 0) {
      // Find the root object of the intersected mesh (the one we added to allPlacedObjects)
      let tappedObjectRoot = intersects[0].object;
      while (tappedObjectRoot.parent && !allPlacedObjects.includes(tappedObjectRoot)) {
          if (tappedObjectRoot.parent === scene) break; // Stop if we reach scene directly (shouldn't happen if logic is right)
          tappedObjectRoot = tappedObjectRoot.parent;
      }

      if (allPlacedObjects.includes(tappedObjectRoot)) { // Ensure it's one of our main objects
          if (selectedForManipulationObject === tappedObjectRoot) {
              // Tapped the already selected object: initiate move gesture.
              moving = true;
              initialTouchPosition = new THREE.Vector2(event.touches[0].pageX, event.touches[0].pageY);
          } else {
              // Tapped a new object: select it. Allow immediate drag.
              selectObject(tappedObjectRoot);
              moving = true; // Set moving flag to true to allow dragging right away.
              initialTouchPosition = new THREE.Vector2(event.touches[0].pageX, event.touches[0].pageY);
          }
          // Reset other gesture flags as 1-finger tap/drag takes precedence or initiates selection
          pinchScaling = pinchRotating = threeFingerMoving = false;
          return; // Object selection/move initiation handled.
      }
    } else {
      // Tapped on empty space: deselect any currently selected object.
      if (selectedForManipulationObject) {
        deselectObject(selectedForManipulationObject);
      }
    }
  }

  // --- Gesture Initiation (for an already selected object, or if no object was tapped) ---
  // If no object is selected, gestures cannot apply.
  if (!selectedForManipulationObject) {
    moving = pinchScaling = pinchRotating = threeFingerMoving = false;
    return;
  }

  // Proceed to check for multi-touch gestures on the selectedForManipulationObject
  if (event.touches.length === 3) {
    threeFingerMoving = true;
    initialZPosition = selectedForManipulationObject.position.y;
    initialThreeFingerY = event.touches[0].pageY;
    pinchScaling = pinchRotating = moving = false; // Turn off other gestures
  } else if (event.touches.length === 2) {
    pinchScaling = true;
    pinchRotating = true;
    initialPinchDistance = getPinchDistance(event.touches);
    initialPinchAngle = getPinchAngle(event.touches);
    // currentScale for pinch should be the selected object's current scale.
    // This was already set in selectObject() or previous onTouchEnd().
    // currentScale = selectedForManipulationObject.scale.x; // Re-affirm if needed, but should be up-to-date.
    moving = threeFingerMoving = false; // Turn off other gestures
  } else if (event.touches.length === 1 && !moving && selectedForManipulationObject) {
    // This handles a scenario where a multi-touch gesture reduces to a single touch
    // over the selected object, potentially starting a move.
    // Or if the first tap didn't intersect but a drag starts over it.
    // However, the primary 1-finger tap->select->move is handled above.
    // This case might be redundant or could be refined if specific edge cases arise.
    // For now, if `moving` wasn't set by direct tap on object, we don't start move here.
    // To enable move if finger just happens to be over selected after other gestures:
    // moving = true;
    // initialTouchPosition = new THREE.Vector2(event.touches[0].pageX, event.touches[0].pageY);
    // pinchScaling = pinchRotating = threeFingerMoving = false;
  }
}

function onTouchMove(event) {
  // Exit if no object is selected or no gesture is active
  if (!selectedForManipulationObject && !moving && !pinchScaling && !threeFingerMoving) return;

  if (threeFingerMoving && event.touches.length === 3 && selectedForManipulationObject) {
    const deltaY = initialThreeFingerY - event.touches[0].pageY;
    selectedForManipulationObject.position.y = initialZPosition + (deltaY * 0.005);
  } else if (pinchScaling && event.touches.length === 2 && selectedForManipulationObject) {
    const newPinchDistance = getPinchDistance(event.touches);
    const scaleChange = newPinchDistance / initialPinchDistance;
    // `currentScale` was set at the start of the pinch (or when object was selected)
    const newObjectScale = currentScale * scaleChange;
    selectedForManipulationObject.scale.set(newObjectScale, newObjectScale, newObjectScale);
    if (pinchRotating) {
      const newPinchAngle = getPinchAngle(event.touches);
      selectedForManipulationObject.rotation.y += (newPinchAngle - initialPinchAngle);
      initialPinchAngle = newPinchAngle; // Update for continuous rotation
    }
  } else if (moving && event.touches.length === 1 && selectedForManipulationObject) {
    const currentTouch = new THREE.Vector2(event.touches[0].pageX, event.touches[0].pageY);
    const dxScreen = currentTouch.x - initialTouchPosition.x;
    const dyScreen = currentTouch.y - initialTouchPosition.y;

    const cameraRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0); // X-axis
    cameraRight.y = 0; cameraRight.normalize();
    const cameraForward = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2); // Z-axis
    cameraForward.negate(); cameraForward.y = 0; cameraForward.normalize(); // Camera looks down -Z

    const worldMoveX = cameraRight.clone().multiplyScalar(dxScreen * MOVE_SENSITIVITY);
    const worldMoveZ = cameraForward.clone().multiplyScalar(-dyScreen * MOVE_SENSITIVITY); // Drag UP -> Away

    selectedForManipulationObject.position.add(worldMoveX);
    selectedForManipulationObject.position.add(worldMoveZ);
    initialTouchPosition.copy(currentTouch);
  }
}

function onTouchEnd(event) {
  if (threeFingerMoving && event.touches.length < 3) {
    threeFingerMoving = false;
  }
  if ((pinchScaling || pinchRotating) && event.touches.length < 2) {
    if (selectedForManipulationObject) {
      // Update the global currentScale to this object's final scale from the pinch.
      // This scale will be used if a NEW object is placed next.
      currentScale = selectedForManipulationObject.scale.x;
    }
    pinchScaling = false;
    pinchRotating = false;
  }
  if (moving && event.touches.length < 1) {
    moving = false;
  }

  // If all touches are up, reset all gesture flags as a safeguard.
  if (event.touches.length === 0) {
    threeFingerMoving = false;
    pinchScaling = false;
    pinchRotating = false;
    moving = false;
  }
}

// --- Utility Functions for Touch Gestures ---
function getPinchDistance(touches) {
  return Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);
}
function getPinchAngle(touches) {
  return Math.atan2(touches[0].pageY - touches[1].pageY, touches[0].pageX - touches[1].pageX);
}