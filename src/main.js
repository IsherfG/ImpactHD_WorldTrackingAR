import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ARButton } from "three/examples/jsm/webxr/ARButton.js";
import "./qr.js"; // Assuming qr.js handles its own UI elements if needed

// style.css is imported via HTML or bundler (Vite automatically handles it)

let container;
let camera, scene, renderer;
let controller;

let reticle;
let object1, object2, object3, object4, object5;

let hitTestSource = null;
let hitTestSourceRequested = false;
let planeFound = false;

let currentScale = 1; // Initial scale for newly placed objects
let lastPlacedObject = null;

let selectedObject = "obj1"; // Default selected object (e.g. first one)

// Variables for tracking pinch gestures
let initialPinchDistance = null;
let pinchScaling = false;

// Variables for tracking pinch rotation
let initialPinchAngle = null;
let pinchRotating = false;

// Variables for tracking single-finger move
let moving = false;
let initialTouchPosition = null;

// Variables for tracking three-finger Z-axis move
let threeFingerMoving = false;
let initialObjectY = null; // Y position of object at start of 3-finger move
let initialThreeFingerTouchY = null; // Screen Y of touches at start of 3-finger move

// UI Elements
const trackingPrompt = document.getElementById("tracking-prompt");
const instructionsElement = document.getElementById("instructions");
const buttonContainer = document.getElementById("button-container");
const placeObjectBtn = document.getElementById("place-object-btn");
const deleteObjectBtn = document.getElementById("delete-object-btn");
const arNotSupportedMessage = document.getElementById("ar-not-supported");

const objectButtons = [
    document.getElementById("object1"),
    document.getElementById("object2"),
    document.getElementById("object3"),
    document.getElementById("object4"),
    document.getElementById("object5"),
].filter(button => button !== null);


// Check for WebXR session support
if ("xr" in navigator) {
  navigator.xr.isSessionSupported("immersive-ar").then((supported) => {
    if (supported) {
      if (arNotSupportedMessage) arNotSupportedMessage.style.display = "none";
      init();
      animate();
    } else {
      showARNotSupported("AR is not supported on this device.");
    }
  }).catch(() => {
      showARNotSupported("Error checking AR support.");
  });
} else {
  showARNotSupported("WebXR API is not available in this browser.");
}

function showARNotSupported(message) {
    if (arNotSupportedMessage) {
        arNotSupportedMessage.textContent = message + " Please try a compatible browser like Chrome on Android or Safari on iOS.";
        arNotSupportedMessage.style.display = "block";
    }
    const appElement = document.getElementById("app");
    if (appElement) appElement.style.display = "flex"; // Ensure #app is visible
}

function sessionStart() {
  planeFound = false;
  if (trackingPrompt) trackingPrompt.style.display = "block";
  if (instructionsElement) instructionsElement.style.display = "none";
  if (buttonContainer) buttonContainer.style.display = "none";
  if (deleteObjectBtn) deleteObjectBtn.style.display = "none";
  document.body.classList.add('ar-active');
}

function sessionEnd() {
  hitTestSourceRequested = false;
  hitTestSource = null;
  planeFound = false;
  if (trackingPrompt) trackingPrompt.style.display = "none"; // Hide prompt when session ends
  if (instructionsElement) instructionsElement.style.display = "none";
  if (buttonContainer) buttonContainer.style.display = "none";
  if (deleteObjectBtn) deleteObjectBtn.style.display = "none";
  if (reticle) reticle.visible = false;
  document.body.classList.remove('ar-active');

  // Clean up scene if objects were placed
  if (lastPlacedObject) {
    scene.remove(lastPlacedObject);
    disposeObject(lastPlacedObject);
    lastPlacedObject = null;
  }
  currentScale = 1; // Reset scale
}

function init() {
  container = document.createElement("div");
  document.body.appendChild(container);

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.01,
    40 // Increased far plane for potentially larger scenes
  );

  const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1.2);
  hemisphereLight.position.set(0.5, 1, 0.25);
  scene.add(hemisphereLight);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  container.appendChild(renderer.domElement);

  renderer.xr.addEventListener("sessionstart", sessionStart);
  renderer.xr.addEventListener("sessionend", sessionEnd);

  const arButton = ARButton.createButton(renderer, {
    requiredFeatures: ["hit-test", "dom-overlay"], // local is usually implied
    domOverlay: { root: document.querySelector("#overlay") },
  });
  // ARButton might add itself to body, or you might need to:
  // document.body.appendChild(arButton); // If it doesn't auto-append to a good spot

  // Style the ARButton if THREE.ARButton is used and gives it an ID
  if (arButton.id) {
      // The CSS already targets #arButton and .ar-button
  } else {
      // If ARButton is generic, you might need to add a class or style it directly
      arButton.style.zIndex = "100"; // Example direct styling
  }


  if (placeObjectBtn) placeObjectBtn.addEventListener("click", onSelect);

  if (deleteObjectBtn) {
    deleteObjectBtn.addEventListener("click", () => {
      if (lastPlacedObject) {
        scene.remove(lastPlacedObject);
        disposeObject(lastPlacedObject);
        lastPlacedObject = null;
        deleteObjectBtn.style.display = "none";
        currentScale = 1;
        if (reticle) reticle.visible = true; // Show reticle again
        if (placeObjectBtn) placeObjectBtn.style.display = 'flex'; // Show place button
      }
    });
  }

  objectButtons.forEach(button => {
    button.addEventListener("click", (event) => {
        event.stopPropagation();
        const objectIdNum = button.id.substring("object".length);
        selectedObject = "obj" + objectIdNum;
        console.log("Selected:", selectedObject);

        objectButtons.forEach(btn => btn.classList.remove("selected"));
        button.classList.add("selected");
    });
  });

  // Set initial selected button
  const initialSelectedButton = document.getElementById(selectedObject.replace("obj", "object"));
  if (initialSelectedButton) {
    initialSelectedButton.classList.add("selected");
  }


  controller = renderer.xr.getController(0);
  // controller.addEventListener('select', onSelect); // Can be used for controller-based placement
  scene.add(controller);

  reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.07, 0.09, 32).rotateX(-Math.PI / 2), // Slightly thinner ring
    new THREE.MeshBasicMaterial({ color: 0x007bff, opacity: 0.8, transparent: true, depthTest: false }) // depthTest false for always visible
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  loadModels();

  window.addEventListener("resize", onWindowResize);

  const overlayElement = document.querySelector("#overlay");
  if (overlayElement) {
    overlayElement.addEventListener("touchstart", onTouchStart, { passive: false });
    overlayElement.addEventListener("touchmove", onTouchMove, { passive: false });
    overlayElement.addEventListener("touchend", onTouchEnd, { passive: false }); // passive:false if you use preventDefault
  }
}

function loadModels() {
    const gltfLoader = new GLTFLoader();
    const textureLoader = new THREE.TextureLoader(); // Single texture loader

    const modelsToLoad = [
        { name: "obj1", file: "Shelf.glb", scale: 0.1, textureFile: null },
        { name: "obj2", file: "Shelf2.glb", scale: 0.1, textureFile: "Shelf.png" },
        { name: "obj3", file: "Bag1.glb", scale: 0.2, textureFile: "Map1.png" },
        { name: "obj4", file: "Bag2.glb", scale: 0.2, textureFile: "Map2.jpg" },
        { name: "obj5", file: "Bag3.glb", scale: 0.2, textureFile: "Map3.png" },
    ];

    modelsToLoad.forEach(modelInfo => {
        gltfLoader.load(modelInfo.file, (gltf) => {
            const modelScene = gltf.scene;
            modelScene.scale.set(modelInfo.scale, modelInfo.scale, modelInfo.scale);

            if (modelInfo.textureFile) {
                const texture = textureLoader.load(modelInfo.textureFile);
                texture.flipY = false;
                texture.colorSpace = THREE.SRGBColorSpace;
                modelScene.traverse(node => {
                    if (node.isMesh && node.material) {
                        node.material.map = texture;
                        node.material.needsUpdate = true;
                    }
                });
            }
            // Assign to the correct global variable (object1, object2, etc.)
            switch(modelInfo.name) {
                case "obj1": object1 = modelScene; break;
                case "obj2": object2 = modelScene; break;
                case "obj3": object3 = modelScene; break;
                case "obj4": object4 = modelScene; break;
                case "obj5": object5 = modelScene; break;
            }
            console.log(`${modelInfo.file} (${modelInfo.name}) loaded`);
        }, undefined, (error) => console.error(`Error loading ${modelInfo.file}`, error));
    });
}

function disposeObject(obj) {
    if (!obj) return;
    obj.traverse(child => {
        if (child.isMesh) {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(material => cleanMaterial(material));
                } else {
                    cleanMaterial(child.material);
                }
            }
        }
    });
}
function cleanMaterial(material) {
    if (!material) return;
    material.dispose();
    for (const key of Object.keys(material)) {
        const value = material[key];
        if (value && typeof value === 'object' && 'isTexture' in value) {
            value.dispose();
        }
    }
}

function onSelect() {
  if (reticle.visible) {
    let sourceObject;
    switch (selectedObject) {
      case "obj1": sourceObject = object1; break;
      case "obj2": sourceObject = object2; break;
      case "obj3": sourceObject = object3; break;
      case "obj4": sourceObject = object4; break;
      case "obj5": sourceObject = object5; break;
      default: console.warn("No model selected or model not loaded"); return;
    }

    if (!sourceObject) {
        console.warn("Selected source object not loaded yet:", selectedObject);
        return;
    }

    // Remove previous object if exists
    if (lastPlacedObject) {
        scene.remove(lastPlacedObject);
        disposeObject(lastPlacedObject);
    }

    const mesh = sourceObject.clone(); // Clone the entire loaded scene group
    mesh.scale.set(1, 1, 1).multiplyScalar(currentScale); // Apply currentScale, not the original model's scale again

    reticle.matrix.decompose(mesh.position, mesh.quaternion, new THREE.Vector3()); // Get pos/rot, ignore scale from reticle

    const cameraPosition = new THREE.Vector3();
    camera.getWorldPosition(cameraPosition);
    const lookAtPosition = new THREE.Vector3(cameraPosition.x, mesh.position.y, cameraPosition.z);
    mesh.lookAt(lookAtPosition);

    scene.add(mesh);
    lastPlacedObject = mesh;

    if (deleteObjectBtn) deleteObjectBtn.style.display = "flex";
    // if (placeObjectBtn) placeObjectBtn.style.display = 'none'; // Optional: hide place btn after placing
    // if (reticle) reticle.visible = false; // Optional: hide reticle after placing

    // Pop-in animation
    const targetScaleVec = mesh.scale.clone();
    mesh.scale.set(0.01, 0.01, 0.01);
    let animTime = 0;
    const animDuration = 0.3;
    const popInInterval = setInterval(() => {
        animTime += 16/1000;
        const progress = Math.min(animTime / animDuration, 1);
        const easeOutProgress = 1 - Math.pow(1 - progress, 3);
        mesh.scale.set(
            0.01 + (targetScaleVec.x - 0.01) * easeOutProgress,
            0.01 + (targetScaleVec.y - 0.01) * easeOutProgress,
            0.01 + (targetScaleVec.z - 0.01) * easeOutProgress
        );
        if (progress >= 1) {
            clearInterval(popInInterval);
            mesh.scale.copy(targetScaleVec);
        }
    }, 16);
  }
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  renderer.setAnimationLoop(render);
}

function render(timestamp, frame) {
  if (frame) {
    const referenceSpace = renderer.xr.getReferenceSpace();
    const session = renderer.xr.getSession();

    if (!session) return;

    if (!hitTestSourceRequested) {
      session.requestReferenceSpace("viewer").then((viewerSpace) => {
        session.requestHitTestSource({ space: viewerSpace })
          .then((source) => { hitTestSource = source; })
          .catch(err => console.error("Failed to request hit test source:", err));
      }).catch(err => console.error("Failed to request viewer reference space:", err));
      hitTestSourceRequested = true;
    }

    if (hitTestSource && !lastPlacedObject) { // Only show reticle if no object is placed OR if you want to always show it
      const hitTestResults = frame.getHitTestResults(hitTestSource);
      if (hitTestResults.length) {
        if (!planeFound) {
          planeFound = true;
          if (trackingPrompt) trackingPrompt.style.display = "none";
          if (instructionsElement) instructionsElement.style.display = "flex";
          if (buttonContainer) buttonContainer.style.display = "flex";
        }
        const hit = hitTestResults[0];
        const pose = hit.getPose(referenceSpace);
        if (pose) {
          reticle.visible = true;
          reticle.matrix.fromArray(pose.transform.matrix);
        } else {
          reticle.visible = false;
        }
      } else {
        reticle.visible = false;
      }
    } else if (lastPlacedObject && reticle) { // Hide reticle if an object is placed
        reticle.visible = false;
    }
  }
  renderer.render(scene, camera);
}


function onTouchStart(event) {
  if (!renderer.xr.isPresenting || !lastPlacedObject && event.touches.length > 0 && event.target.closest('#button-container')) {
     // Allow touch on UI buttons even if no object is placed or AR not active
     // This check might be too broad, ensure it doesn't interfere with AR interactions
     return;
  }
  event.preventDefault(); // Prevent default only for AR interactions on canvas/overlay

  if (!lastPlacedObject) return;

  if (event.touches.length === 3) {
    threeFingerMoving = true;
    initialObjectY = lastPlacedObject.position.y;
    initialThreeFingerTouchY = (event.touches[0].pageY + event.touches[1].pageY + event.touches[2].pageY) / 3;
  } else if (event.touches.length === 2) {
    pinchScaling = true;
    pinchRotating = true;
    initialPinchDistance = getPinchDistance(event.touches);
    initialPinchAngle = getPinchAngle(event.touches);
    currentScale = lastPlacedObject.scale.x; // Capture scale at start of pinch
  } else if (event.touches.length === 1) {
    // Check if the touch is on a UI element (like a button)
    // This is a bit tricky with DOM overlay. If touch is on UI, don't start moving.
    // The `event.target.closest('#button-container')` check at the beginning handles some of this.
    // If it's not on UI, then proceed with moving.
    if (event.target === renderer.domElement || event.target === document.getElementById('overlay')) {
        moving = true;
        initialTouchPosition = new THREE.Vector2(event.touches[0].pageX, event.touches[0].pageY);
    }
  }
}

function onTouchMove(event) {
  if (!renderer.xr.isPresenting) return;
  event.preventDefault(); // Prevent default for AR interactions

  if (!lastPlacedObject) return;

  if (event.touches.length === 3 && threeFingerMoving) {
    const currentThreeFingerY = (event.touches[0].pageY + event.touches[1].pageY + event.touches[2].pageY) / 3;
    const deltaScreenY = initialThreeFingerTouchY - currentThreeFingerY; // Drag up = positive delta
    const moveAmount = deltaScreenY * 0.003; // Sensitivity for Y movement
    lastPlacedObject.position.y = initialObjectY + moveAmount;
  } else if (event.touches.length === 2 && (pinchScaling || pinchRotating)) {
    const newPinchDistance = getPinchDistance(event.touches);
    const newPinchAngle = getPinchAngle(event.touches);

    if (pinchScaling && initialPinchDistance > 0) {
      const scaleFactor = newPinchDistance / initialPinchDistance;
      const newScaleValue = currentScale * scaleFactor;
      if (newScaleValue > 0.01) { // Add a minimum scale threshold
          lastPlacedObject.scale.set(newScaleValue, newScaleValue, newScaleValue);
      }
    }
    if (pinchRotating) {
      const angleChange = newPinchAngle - initialPinchAngle;
      lastPlacedObject.rotation.y += angleChange;
      initialPinchAngle = newPinchAngle;
    }
  } else if (event.touches.length === 1 && moving) {
    const currentTouchPosition = new THREE.Vector2(event.touches[0].pageX, event.touches[0].pageY);
    const screenDeltaX = (currentTouchPosition.x - initialTouchPosition.x);
    const screenDeltaY = (currentTouchPosition.y - initialTouchPosition.y);

    // More intuitive: Dragging right moves object right, dragging up moves object away from camera
    const moveVector = new THREE.Vector3(screenDeltaX / window.innerWidth, 0, screenDeltaY / window.innerHeight);
    moveVector.applyQuaternion(camera.quaternion);
    moveVector.y = 0; // Ensure planar movement
    
    // A different approach for sensitivity: scale by distance to object or fixed factor
    const moveSensitivity = 0.7; // Adjust for desired speed
    lastPlacedObject.position.add(moveVector.multiplyScalar(moveSensitivity));

    initialTouchPosition.copy(currentTouchPosition);
  }
}

function onTouchEnd(event) {
   // No preventDefault here generally, unless a specific gesture needs it

  if (threeFingerMoving && event.touches.length < 3) {
    threeFingerMoving = false;
    initialObjectY = null;
    initialThreeFingerTouchY = null;
  }
  if ((pinchScaling || pinchRotating) && event.touches.length < 2) {
    if (pinchScaling && lastPlacedObject) {
        currentScale = lastPlacedObject.scale.x; // Update currentScale to the final scale
    }
    pinchScaling = false;
    pinchRotating = false;
    initialPinchDistance = null;
    initialPinchAngle = null;
  }
  if (moving && event.touches.length < 1) {
    moving = false;
    initialTouchPosition = null;
  }
}

function getPinchDistance(touches) {
  if (touches.length < 2) return 0;
  const dx = touches[0].pageX - touches[1].pageX;
  const dy = touches[0].pageY - touches[1].pageY;
  return Math.sqrt(dx * dx + dy * dy);
}

function getPinchAngle(touches) {
  if (touches.length < 2) return 0;
  const dx = touches[0].pageX - touches[1].pageX;
  const dy = touches[0].pageY - touches[1].pageY;
  return Math.atan2(dy, dx);
}