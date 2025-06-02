import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ARButton } from "three/examples/jsm/webxr/ARButton.js";
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import "./qr.js"; // Assuming this is part of your setup
import "./style.css"; // Make sure this is linked

let container;
let camera, scene, renderer;
let controller;
let reticle;

let object1, object2, object3, object4, object5; // Loaded GLTF models

let hitTestSource = null;
let hitTestSourceRequested = false;
let planeFound = false;

const DEFAULT_OBJECT_SCALE = 0.2;
let currentScale = DEFAULT_OBJECT_SCALE;
let lastPlacedObject = null;

let selectedObject = "obj1"; // Default selected object ID

// Touch gesture variables
let initialPinchDistance = null;
let pinchScaling = false;
let initialPinchAngle = null;
let pinchRotating = false;
let moving = false;
let initialTouchPosition = null;
const MOVE_SENSITIVITY = 0.002;
let threeFingerMoving = false;
let initialZPosition = null;
let initialThreeFingerY = null;

// Path to your HDR environment map
const HDR_ENVIRONMENT_MAP_PATH = 'hdr.hdr'; // REPLACE WITH YOUR ACTUAL PATH

// --- UI Helper ---
function updateSelectedObjectButton(selectedId) {
    document.querySelectorAll('.object-btn').forEach(btn => {
        btn.classList.remove('selected');
        if (btn.dataset.objectId === selectedId) {
            btn.classList.add('selected');
        }
    });
}

// --- WebXR Support Check ---
if ("xr" in navigator) {
  navigator.xr.isSessionSupported("immersive-ar").then((supported) => {
    if (supported) {
      document.getElementById("ar-not-supported").style.display = "none";
      init();
      animate();
    } else {
      document.getElementById("ar-not-supported").innerHTML =
        "Immersive AR not supported. Try on a compatible mobile device.";
      const arButtonElement = document.querySelector("#ARButton") || document.querySelector(".ar-button");
      if (arButtonElement) arButtonElement.style.display = "none";
    }
  }).catch((err) => {
    console.error("Error checking AR support:", err);
    document.getElementById("ar-not-supported").innerHTML = "Error checking AR support.";
  });
} else {
  document.getElementById("ar-not-supported").innerHTML = "WebXR API not found. Try a modern browser.";
}

// --- AR Session Lifecycle ---
function sessionStart() {
  planeFound = false;
  document.getElementById("tracking-prompt").style.display = "flex";
  document.getElementById("top-bar").style.display = "none";
  document.getElementById("bottom-controls").style.display = "none";
  document.getElementById("delete-object-btn").style.display = "none";
}

// --- Initialization ---
function init() {
  container = document.createElement("div");
  document.body.appendChild(container);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

  // Lighting
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

  // Renderer
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

  // Environment Map
  new RGBELoader()
    .setPath('') // Adjust if your HDR is in a subfolder of public, e.g., 'assets/'
    .load(HDR_ENVIRONMENT_MAP_PATH, function (texture) {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      scene.environment = texture;
      console.log("Environment map '" + HDR_ENVIRONMENT_MAP_PATH + "' loaded.");
    }, undefined, function(error) {
        console.error(`Could not load HDR: '${HDR_ENVIRONMENT_MAP_PATH}'. Error:`, error);
    });

  // AR Button
  const arButton = ARButton.createButton(renderer, {
    requiredFeatures: ["local", "hit-test", "dom-overlay"],
    domOverlay: { root: document.querySelector("#overlay") },
  });
  document.body.appendChild(arButton);

  // UI Event Listeners
  document.getElementById("place-object-btn").addEventListener("click", onSelect);
  document.getElementById("delete-object-btn").addEventListener("click", () => {
    if (lastPlacedObject) {
      scene.remove(lastPlacedObject);
      lastPlacedObject.traverse(child => { /* ... disposal ... */ }); // Basic disposal
      lastPlacedObject = null;
      document.getElementById("delete-object-btn").style.display = "none";
    }
  });

  document.querySelectorAll('.object-btn').forEach(button => {
    button.addEventListener('click', (event) => {
        event.stopPropagation();
        const objectId = button.dataset.objectId;
        selectedObject = objectId;
        updateSelectedObjectButton(objectId);
    });
  });
  // Initial selected object UI update
  const firstObjectButton = document.querySelector('.object-btn');
  if (firstObjectButton) {
      selectedObject = firstObjectButton.dataset.objectId; // Set based on first button
      updateSelectedObjectButton(selectedObject);
  }


  // Reticle
  reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.075, 0.1, 24).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, side: THREE.DoubleSide })
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  // GLTF Loading
  const gltfLoader = new GLTFLoader();
  const textureLoader = new THREE.TextureLoader();
  const loadErrorCallback = (name) => (error) => console.error(`Error loading ${name}:`, error);

  function applyTextureToGLTF(gltfScene, texture) {
    gltfScene.traverse(node => {
        if (node.isMesh) {
            // It's often better to create a new material instance or clone
            // to avoid sharing materials if the same GLTF is loaded multiple times
            // or if its original material is complex.
            let newMaterial;
            if (node.material && node.material.isMeshStandardMaterial) {
                newMaterial = node.material.clone();
            } else {
                newMaterial = new THREE.MeshStandardMaterial(); // Basic fallback
                if (node.material && node.material.color) {
                    newMaterial.color.copy(node.material.color);
                }
            }
            newMaterial.map = texture;
            newMaterial.needsUpdate = true; // Important if replacing material
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


  window.addEventListener("resize", onWindowResize);
  // Touch Listeners
  window.addEventListener("touchstart", onTouchStart, { passive: false });
  window.addEventListener("touchmove", onTouchMove, { passive: false });
  window.addEventListener("touchend", onTouchEnd, false);
}

// --- Object Placement ---
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
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.traverse(child => {
          if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
          }
      });

      const newPosition = new THREE.Vector3();
      const newQuaternion = new THREE.Quaternion();
      reticle.matrix.decompose(newPosition, newQuaternion, new THREE.Vector3()); // Temp scale vec
      mesh.position.copy(newPosition);
      mesh.quaternion.copy(newQuaternion);
      mesh.scale.set(currentScale, currentScale, currentScale);

      const cameraLookAt = new THREE.Vector3();
      camera.getWorldPosition(cameraLookAt);
      mesh.lookAt(cameraLookAt.x, mesh.position.y, cameraLookAt.z);

      scene.add(mesh);
      lastPlacedObject = mesh;
      document.getElementById("delete-object-btn").style.display = "flex"; // Show delete button

      // Entry animation
      const targetScaleVal = mesh.scale.x;
      mesh.scale.setScalar(targetScaleVal * 0.1);
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
    }
  }
}


// --- Window Resize ---
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- Animation Loop ---
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

      session.addEventListener("end", () => {
        hitTestSourceRequested = false; hitTestSource = null; planeFound = false;
        document.getElementById("tracking-prompt").style.display = "none";
        document.getElementById("top-bar").style.display = "none";
        document.getElementById("bottom-controls").style.display = "none";
        if (lastPlacedObject) scene.remove(lastPlacedObject);
        lastPlacedObject = null; currentScale = DEFAULT_OBJECT_SCALE;
      });
      hitTestSourceRequested = true;
    }

    if (hitTestSource && referenceSpace) {
      const hitTestResults = frame.getHitTestResults(hitTestSource);
      if (hitTestResults.length) {
        if (!planeFound) {
          planeFound = true;
          document.getElementById("tracking-prompt").style.display = "none";
          document.getElementById("top-bar").style.display = "flex";
          document.getElementById("bottom-controls").style.display = "flex";
          document.getElementById("instruction-text").textContent = "Tap reticle to place";
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
  if (event.touches.length === 3 && lastPlacedObject) {
    threeFingerMoving = true;
    initialZPosition = lastPlacedObject.position.y;
    initialThreeFingerY = event.touches[0].pageY;
    pinchScaling = pinchRotating = moving = false;
  } else if (event.touches.length === 2 && lastPlacedObject) {
    pinchScaling = true; pinchRotating = true;
    initialPinchDistance = getPinchDistance(event.touches);
    initialPinchAngle = getPinchAngle(event.touches);
    // Capture the scale of the object AT THE START of this specific pinch gesture
    // This is NOT necessarily the global `currentScale` (which is for new objects)
    // Let's use a temporary variable or just use lastPlacedObject.scale.x directly in onTouchMove
    // For now, using currentScale here means the pinch is relative to the scale of the *last action*
    // If last action was placing a new obj, currentScale = DEFAULT_OBJECT_SCALE (or last pinch scale)
    // If last action was pinching another obj, currentScale = that obj's final scale
    // To make pinch always relative to *this* object's current scale:
    // No, currentScale IS updated in onTouchEnd, so this is correct: it captures the scale
    // of the currently active object before this new pinch starts.
    currentScale = lastPlacedObject.scale.x; // This is the scale to be modified by this pinch
    moving = threeFingerMoving = false;
  } else if (event.touches.length === 1 && lastPlacedObject) {
    let targetElement = event.target; let ignoreTap = false;
    while(targetElement && targetElement !== document.body) {
        if (targetElement.dataset && targetElement.dataset.ignoreTap === 'true') { ignoreTap = true; break; }
        if (targetElement.id === 'object-selector' || targetElement.id === 'action-buttons' || targetElement.closest('#object-selector') || targetElement.closest('#action-buttons')) {
            ignoreTap = true; break;
        }
        targetElement = targetElement.parentElement;
    }
    if (!ignoreTap) {
        moving = true;
        initialTouchPosition = new THREE.Vector2(event.touches[0].pageX, event.touches[0].pageY);
        pinchScaling = pinchRotating = threeFingerMoving = false;
    } else {
        moving = false; // Ensure moving is false if tap is on UI
    }
  }
}

function onTouchMove(event) {
  if (threeFingerMoving && event.touches.length === 3 && lastPlacedObject) {
    const deltaY = initialThreeFingerY - event.touches[0].pageY;
    lastPlacedObject.position.y = initialZPosition + (deltaY * 0.005);
  } else if (pinchScaling && event.touches.length === 2 && lastPlacedObject) {
    const newPinchDistance = getPinchDistance(event.touches);
    const scaleChange = newPinchDistance / initialPinchDistance;
    // `currentScale` here is the object's scale at the START of THIS pinch.
    const newObjectScale = currentScale * scaleChange;
    lastPlacedObject.scale.set(newObjectScale, newObjectScale, newObjectScale);
    if (pinchRotating) {
      const newPinchAngle = getPinchAngle(event.touches);
      lastPlacedObject.rotation.y += (newPinchAngle - initialPinchAngle);
      initialPinchAngle = newPinchAngle;
    }
  } else if (moving && event.touches.length === 1 && lastPlacedObject) {
    const currentTouch = new THREE.Vector2(event.touches[0].pageX, event.touches[0].pageY);
    const dxScreen = currentTouch.x - initialTouchPosition.x;
    const dyScreen = currentTouch.y - initialTouchPosition.y;

    const cameraRight = new THREE.Vector3();
    cameraRight.setFromMatrixColumn(camera.matrixWorld, 0); // X-axis
    cameraRight.y = 0; cameraRight.normalize();

    const cameraForward = new THREE.Vector3();
    cameraForward.setFromMatrixColumn(camera.matrixWorld, 2); // Z-axis
    cameraForward.negate(); // Camera looks down -Z
    cameraForward.y = 0; cameraForward.normalize();

    const worldMoveX = cameraRight.clone().multiplyScalar(dxScreen * MOVE_SENSITIVITY);
    const worldMoveZ = cameraForward.clone().multiplyScalar(-dyScreen * MOVE_SENSITIVITY); // Drag UP -> Away

    lastPlacedObject.position.add(worldMoveX);
    lastPlacedObject.position.add(worldMoveZ);
    initialTouchPosition.copy(currentTouch);
  }
}

function onTouchEnd(event) {
  if (threeFingerMoving && event.touches.length < 3) threeFingerMoving = false;
  if ((pinchScaling || pinchRotating) && event.touches.length < 2) {
    if (lastPlacedObject) {
      // Update the global currentScale to this object's final scale,
      // so the *next* placed object can inherit it if desired.
      currentScale = lastPlacedObject.scale.x;
    }
    pinchScaling = false; pinchRotating = false;
  }
  if (moving && event.touches.length < 1) moving = false;
  if (event.touches.length === 0) { // Reset all flags if all fingers up
    threeFingerMoving = pinchScaling = pinchRotating = moving = false;
  }
}

function getPinchDistance(touches) {
  const dx = touches[0].pageX - touches[1].pageX;
  const dy = touches[0].pageY - touches[1].pageY;
  return Math.sqrt(dx * dx + dy * dy);
}

function getPinchAngle(touches) {
  const dx = touches[0].pageX - touches[1].pageX;
  const dy = touches[0].pageY - touches[1].pageY;
  return Math.atan2(dy, dx);
}