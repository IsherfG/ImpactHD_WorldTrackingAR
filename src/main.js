import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { ARButton } from "three/examples/jsm/webxr/ARButton.js";
import "./qr.js"; // Assuming qr.js is correctly set up for VLaunch

// CSS import for Vite/Rollup, if not using, ensure style.css is linked in HTML
import "./style.css";

let container;
let camera, scene, renderer;
let controller;
let reticle;

let hitTestSource = null;
let hitTestSourceRequested = false;
let planeFound = false;

// --- Multi-Object and Selection ---
let placedObjects = [];
let selectedPlacedObject = null;
let selectionBox = null; // Using BoxHelper for selection highlight

// --- Model Management ---
let modelBeingPlacedType = "obj1"; // Default object type to place
const modelsBasePath = "./"; // Adjust if your models are in a subdirectory e.g. "models/"
const modelConfigs = {
  obj1: { path: "Shelf.glb", texture: null, name: "Shelf" },
  obj2: { path: "Shelf2.glb", texture: "Shelf.png", name: "Patterned Shelf" },
  obj3: { path: "Bag1.glb", texture: "Map1.png", name: "Bag Design 1" },
  obj4: { path: "Bag2.glb", texture: "Map2.jpg", name: "Bag Design 2" },
  obj5: { path: "Bag3.glb", texture: "Map3.png", name: "Bag Design 3" },
};
let modelsCache = {};
let modelsLoading = {}; // Tracks loading state e.g. modelsLoading['obj1'] = true

// --- Interaction ---
let currentBaseScale = 0.3; // Initial scale for newly placed objects, can be model-specific later
let initialPinchDistance = null;
let pinchScaling = false;
let initialPinchAngle = null;
let pinchRotating = false;
let moving = false;
let initialTouchPosition = null; // For 1-finger move
let touchStartTime = 0; // For differentiating tap from drag

let threeFingerMoving = false;
let initialZPosition = null; // For 3-finger Y-axis (height) move
let initialThreeFingerY = null;

const raycaster = new THREE.Raycaster();
const tapPosition = new THREE.Vector2();

// DOM Elements
const instructionText = document.getElementById("instructions");
const trackingPrompt = document.getElementById("tracking-prompt");
const buttonContainer = document.getElementById("button-container");
const placeObjectButton = document.getElementById("place-object-btn");
const deleteObjectButton = document.getElementById("delete-object-btn");
const arNotSupportedDiv = document.getElementById("ar-not-supported");
const appDiv = document.getElementById("app");


// Check for WebXR session support
if ("xr" in navigator) {
  navigator.xr.isSessionSupported("immersive-ar").then((supported) => {
    if (supported) {
      arNotSupportedDiv.style.display = "none";
      init();
      // animate() is called by renderer.setAnimationLoop in init()
    } else {
      appDiv.style.zIndex = "20"; // Show #app content above other things if AR not supported
      arNotSupportedDiv.style.display = "block";
      instructionText.style.display = "none";
      trackingPrompt.style.display = "none";
    }
  }).catch(() => {
      appDiv.style.zIndex = "20";
      arNotSupportedDiv.style.display = "block";
      instructionText.style.display = "none";
      trackingPrompt.style.display = "none";
  });
} else {
    appDiv.style.zIndex = "20";
    arNotSupportedDiv.style.display = "block";
    instructionText.style.display = "none";
    trackingPrompt.style.display = "none";
}


function sessionStart() {
  planeFound = false;
  trackingPrompt.style.display = "block";
  instructionText.textContent = "Scan your environment to find a surface.";
  instructionText.style.display = "block";
  buttonContainer.style.display = "none";
  placeObjectButton.style.display = "none";
  deleteObjectButton.style.display = "none";
  appDiv.style.display = "none"; // Hide non-AR UI
}

function sessionEnd() {
    planeFound = false;
    trackingPrompt.style.display = "none";
    instructionText.style.display = "none";
    buttonContainer.style.display = "none";
    placeObjectButton.style.display = "none";
    deleteObjectButton.style.display = "none";

    // Clean up scene
    while(placedObjects.length > 0){
        const obj = placedObjects.pop();
        disposeObject(obj);
        scene.remove(obj);
    }
    if (selectionBox) {
        scene.remove(selectionBox);
        selectionBox.dispose();
        selectionBox = null;
    }
    selectedPlacedObject = null;
    appDiv.style.display = "flex"; // Show non-AR UI again
}

function init() {
  container = document.createElement("div");
  document.body.appendChild(container);

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.01,
    40 // Increased far plane for larger scenes
  );

  // Lights
  const ambientLight = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 0.7); // Softer ambient
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8); // Brighter directional
  directionalLight.position.set(0.5, 1.5, 0.75);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 1024; // default
  directionalLight.shadow.mapSize.height = 1024; // default
  directionalLight.shadow.camera.near = 0.1;
  directionalLight.shadow.camera.far = 30; // Adjust to fit scene
  directionalLight.shadow.camera.top = 2;
  directionalLight.shadow.camera.bottom = -2;
  directionalLight.shadow.camera.left = -2;
  directionalLight.shadow.camera.right = 2;
  scene.add(directionalLight);
  // const helper = new THREE.CameraHelper( directionalLight.shadow.camera ); // Debug shadows
  // scene.add( helper );

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.shadowMap.enabled = true; // Enable shadows
  renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Softer shadows
  container.appendChild(renderer.domElement);

  renderer.xr.addEventListener("sessionstart", sessionStart);
  renderer.xr.addEventListener("sessionend", sessionEnd);


  const arButton = ARButton.createButton(renderer, {
    requiredFeatures: ["local", "hit-test", "dom-overlay"],
    domOverlay: { root: document.querySelector("#overlay") },
  });
  // ARButton is added to body by its own script, we may want to move it or style it via its class .xr-button-overlay

  document.body.appendChild(arButton);


  // Reticle
  reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.075, 0.1, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x007bff, opacity: 0.7, transparent: true })
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  // --- Object Selection Buttons & Placement/Deletion ---
  Object.keys(modelConfigs).forEach(key => {
    const button = document.getElementById(key);
    modelsLoading[key] = false;
    if (button) {
      button.addEventListener("click", (event) => {
        event.stopPropagation(); // Prevent tap from propagating to AR object selection
        modelBeingPlacedType = key;
        setActiveObjectButton(key);
        // Pre-load model if not already cached
        if (!modelsCache[key] && !modelsLoading[key]) {
          loadModel(key);
        }
        instructionText.textContent = `Tap '+' to place ${modelConfigs[key].name}.`;
      });
    }
  });
  setActiveObjectButton(modelBeingPlacedType); // Set initial active button

  placeObjectButton.addEventListener("click", (event) => {
    event.stopPropagation();
    onPlaceObjectRequest();
  });
  
  deleteObjectButton.addEventListener("click", (event) => {
    event.stopPropagation();
    if (selectedPlacedObject) {
      const index = placedObjects.indexOf(selectedPlacedObject);
      if (index > -1) {
        placedObjects.splice(index, 1);
      }
      disposeObject(selectedPlacedObject); // Clean up Three.js resources
      scene.remove(selectedPlacedObject);
      selectedPlacedObject = null;

      if (selectionBox) {
        scene.remove(selectionBox);
        selectionBox.dispose();
        selectionBox = null;
      }
      deleteObjectButton.style.display = "none";
      instructionText.textContent = "Surface found. Choose an object to place.";
    }
  });

  controller = renderer.xr.getController(0); // Controller for tap events if needed, though we use screen touches
  scene.add(controller);

  // Initialize DRACOLoader
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath("https://www.gstatic.com/draco/v1/decoders/"); // Adjust path if self-hosting

  const gltfLoader = new GLTFLoader();
  gltfLoader.setDRACOLoader(dracoLoader);

  // Function to load a model
  window.loadModel = (modelKey) => { // Expose to window for button calls if needed, or call directly
    if (modelsCache[modelKey] || modelsLoading[modelKey]) return;

    modelsLoading[modelKey] = true;
    const config = modelConfigs[modelKey];
    const button = document.getElementById(modelKey);
    if(button) button.classList.add('loading');

    gltfLoader.load(
      modelsBasePath + config.path,
      (gltf) => {
        const modelScene = gltf.scene;
        if (config.texture) {
          const textureLoader = new THREE.TextureLoader();
          const texture = textureLoader.load(modelsBasePath + config.texture);
          texture.flipY = false; // Crucial for GLTF
          texture.encoding = THREE.sRGBEncoding; // Ensure correct color space
          modelScene.traverse((node) => {
            if (node.isMesh && node.material) {
              node.material.map = texture;
              node.material.needsUpdate = true;
            }
          });
        }
        
        modelScene.traverse(node => {
            if(node.isMesh) {
                node.castShadow = true;
                // node.receiveShadow = true; // Only if objects can cast shadows on each other
            }
        });

        modelsCache[modelKey] = modelScene;
        modelsLoading[modelKey] = false;
        if(button) button.classList.remove('loading');
        console.log(`${config.name} loaded successfully.`);
        if (modelBeingPlacedType === modelKey && planeFound) {
             instructionText.textContent = `Tap '+' to place ${modelConfigs[modelKey].name}.`;
        }
      },
      undefined, // Progress callback (optional)
      (error) => {
        console.error(`Error loading ${config.name}:`, error);
        modelsLoading[modelKey] = false;
        if(button) button.classList.remove('loading');
        if(button) button.disabled = true; // Disable button if model fails
         if (modelBeingPlacedType === modelKey) {
            instructionText.textContent = `Error loading ${config.name}. Try another.`;
        }
      }
    );
  };

  // Pre-load the default selected model
  if (modelBeingPlacedType && !modelsCache[modelBeingPlacedType]) {
    loadModel(modelBeingPlacedType);
  }

  window.addEventListener("resize", onWindowResize);
  window.addEventListener("touchstart", onTouchStart, { passive: false });
  window.addEventListener("touchmove", onTouchMove, { passive: false });
  window.addEventListener("touchend", onTouchEnd, { passive: false });

  renderer.setAnimationLoop(render);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function render(timestamp, frame) {
  if (frame) {
    const referenceSpace = renderer.xr.getReferenceSpace();
    const session = renderer.xr.getSession();

    if (hitTestSourceRequested === false) {
      session.requestReferenceSpace("viewer").then((refSpace) => {
        session.requestHitTestSource({ space: refSpace }).then((source) => {
          hitTestSource = source;
        });
      });
      session.addEventListener("end", () => {
        hitTestSourceRequested = false;
        hitTestSource = null;
      });
      hitTestSourceRequested = true;
    }

    if (hitTestSource) {
      const hitTestResults = frame.getHitTestResults(hitTestSource);
      if (hitTestResults.length) {
        if (!planeFound) {
          planeFound = true;
          trackingPrompt.style.display = "none";
          buttonContainer.style.display = "flex";
          placeObjectButton.style.display = "flex";
          instructionText.textContent = modelsCache[modelBeingPlacedType] ?
             `Tap '+' to place ${modelConfigs[modelBeingPlacedType].name}.` :
             `Loading ${modelConfigs[modelBeingPlacedType].name}...`;
        }
        const hit = hitTestResults[0];
        reticle.visible = true;
        reticle.matrix.fromArray(hit.getPose(referenceSpace).transform.matrix);
      } else {
        reticle.visible = false;
        if (planeFound) { // If plane was found but now lost
            // Optionally, temporarily hide placement UI or show "point at surface"
        }
      }
    }
  }

  if (selectionBox && selectedPlacedObject) {
    selectionBox.setFromObject(selectedPlacedObject); // Update BoxHelper
  }

  renderer.render(scene, camera);
}

function onPlaceObjectRequest() {
  if (reticle.visible && modelBeingPlacedType) {
    const modelAsset = modelsCache[modelBeingPlacedType];
    if (!modelAsset) {
      instructionText.textContent = `Model ${modelConfigs[modelBeingPlacedType].name} is still loading...`;
      if (!modelsLoading[modelBeingPlacedType]) loadModel(modelBeingPlacedType); // Attempt to load if not already
      return;
    }

    const newObject = modelAsset.clone(); // CLONE the cached model

    // Deselect any previously selected object
    if (selectedPlacedObject) {
        deselectCurrentObject();
    }

    reticle.matrix.decompose(newObject.position, newObject.quaternion, newObject.scale); // Get position and orientation from reticle
    
    // Set initial scale
    newObject.scale.set(currentBaseScale, currentBaseScale, currentBaseScale);

    // Make object look towards the camera (horizontally)
    const cameraPosition = new THREE.Vector3();
    camera.getWorldPosition(cameraPosition);
    newObject.lookAt(cameraPosition.x, newObject.position.y, cameraPosition.z);
    // newObject.rotateY(Math.PI); // Often GLBs are exported facing -Z, this corrects to +Z if needed

    scene.add(newObject);
    placedObjects.push(newObject);
    
    selectObject(newObject); // Select the newly placed object

    // Smooth pop-in animation
    newObject.scale.set(0.01, 0.01, 0.01);
    let targetScale = currentBaseScale;
    let animScale = 0.01;
    const scaleInterval = setInterval(() => {
        animScale += (targetScale - animScale) * 0.2; // Ease-out
        newObject.scale.set(animScale, animScale, animScale);
        if (selectedPlacedObject === newObject) { // Update BoxHelper during animation if it's selected
             if(selectionBox) selectionBox.setFromObject(newObject);
        }
        if (Math.abs(targetScale - animScale) < 0.005) {
            newObject.scale.set(targetScale, targetScale, targetScale);
            if (selectedPlacedObject === newObject && selectionBox) selectionBox.setFromObject(newObject);
            clearInterval(scaleInterval);
        }
    }, 16);
  }
}

function selectObject(objectToSelect) {
    if (selectedPlacedObject && selectedPlacedObject !== objectToSelect) {
        deselectCurrentObject();
    }
    selectedPlacedObject = objectToSelect;
    if (!selectionBox) {
        selectionBox = new THREE.BoxHelper(selectedPlacedObject, 0xffff00); // Yellow
        scene.add(selectionBox);
    } else {
        selectionBox.setFromObject(selectedPlacedObject);
        selectionBox.visible = true;
    }
    deleteObjectButton.style.display = "flex"; // Show delete button
    currentBaseScale = selectedPlacedObject.scale.x; // Update current scale for pinch reference
    instructionText.textContent = "Use gestures to move, scale, or rotate. Tap empty space to deselect.";
}

function deselectCurrentObject() {
    if (selectedPlacedObject) {
        // Any visual deselection cues would go here (e.g., remove outline)
        if (selectionBox) {
            selectionBox.visible = false;
        }
        selectedPlacedObject = null;
        deleteObjectButton.style.display = "none";
        if (planeFound) {
             instructionText.textContent = modelsCache[modelBeingPlacedType] ?
             `Tap '+' to place ${modelConfigs[modelBeingPlacedType].name}.` :
             `Loading ${modelConfigs[modelBeingPlacedType].name}...`;
        }
    }
}

function setActiveObjectButton(activeKey) {
  document.querySelectorAll('.object-btn').forEach(btn => {
    if (btn.id === activeKey) {
      btn.classList.add('active-selection');
    } else {
      btn.classList.remove('active-selection');
    }
  });
}

function onTouchStart(event) {
  // event.preventDefault(); // May be needed for some devices to prevent page scroll, test carefully

  if (event.touches.length === 1) {
    const touch = event.touches[0];
    let targetElement = touch.target;
    let ignoreTap = false;
    while (targetElement != null) {
        if (targetElement.dataset && targetElement.dataset.ignoreTap === "true") {
            ignoreTap = true;
            break;
        }
        targetElement = targetElement.parentElement;
    }

    if (ignoreTap) {
        moving = false; // Ensure gestures don't start on UI elements
        return;
    }
    
    moving = true; // Assume moving, will be a tap if duration is short and no movement
    initialTouchPosition = new THREE.Vector2(touch.pageX, touch.pageY);
    touchStartTime = Date.now();

  } else if (event.touches.length === 2 && selectedPlacedObject) {
    pinchScaling = true;
    pinchRotating = true;
    initialPinchDistance = getPinchDistance(event.touches);
    initialPinchAngle = getPinchAngle(event.touches);
    currentBaseScale = selectedPlacedObject.scale.x; // Store current scale before pinch
    moving = false; // Not a single finger move
  } else if (event.touches.length === 3 && selectedPlacedObject) {
    threeFingerMoving = true;
    initialZPosition = selectedPlacedObject.position.y;
    initialThreeFingerY = event.touches[0].pageY; // Use average or first touch
    moving = false; // Not a single finger move
  }
}

function onTouchMove(event) {
  // event.preventDefault(); // Test if needed

  if (!selectedPlacedObject) {
    moving = false; // Don't process moves if no object is selected (and not a UI interaction)
    pinchScaling = false;
    pinchRotating = false;
    threeFingerMoving = false;
    return;
  }

  if (threeFingerMoving && event.touches.length === 3) {
    const deltaY = initialThreeFingerY - event.touches[0].pageY;
    selectedPlacedObject.position.y = initialZPosition + deltaY * 0.005; // Adjust sensitivity
  } else if (pinchScaling || pinchRotating && event.touches.length === 2) {
    const newPinchDistance = getPinchDistance(event.touches);
    const newPinchAngle = getPinchAngle(event.touches);

    if (pinchScaling) {
      const scaleChange = newPinchDistance / initialPinchDistance;
      const finalScale = currentBaseScale * scaleChange;
      selectedPlacedObject.scale.set(finalScale, finalScale, finalScale);
    }
    if (pinchRotating) {
      const angleChange = newPinchAngle - initialPinchAngle;
      selectedPlacedObject.rotation.y += angleChange;
      initialPinchAngle = newPinchAngle; // Update for continuous rotation
    }
  } else if (moving && event.touches.length === 1) {
    const currentTouchPosition = new THREE.Vector2(event.touches[0].pageX, event.touches[0].pageY);
    if (!initialTouchPosition) { // Should be set in onTouchStart
        initialTouchPosition = currentTouchPosition.clone();
        return;
    }
    const deltaX = (currentTouchPosition.x - initialTouchPosition.x);
    const deltaZ = (currentTouchPosition.y - initialTouchPosition.y); // pageY for Z-like depth movement

    // Convert screen delta to world space movement relative to camera
    const camInverse = camera.matrixWorldInverse.clone(); // More stable than camera.quaternion for this
    const moveSpeedFactor = 0.0015 * (selectedPlacedObject.position.distanceTo(camera.position) / 5); // Scale speed with distance
    
    let moveVector = new THREE.Vector3(-deltaX * moveSpeedFactor, 0, -deltaZ * moveSpeedFactor);
    moveVector.applyMatrix4(camera.matrixWorld).sub(camera.getWorldPosition(new THREE.Vector3())); // Transform to world direction
    moveVector.y = 0; // Keep movement on the horizontal plane relative to object's current height

    selectedPlacedObject.position.add(moveVector);
    initialTouchPosition.copy(currentTouchPosition);
  }
}

function onTouchEnd(event) {
  const touchDuration = Date.now() - touchStartTime;
  
  // Check if it was a tap on an object or empty space
  if (moving && event.changedTouches.length === 1 && touchDuration < 250) { // Tap is short duration
    const endTouch = event.changedTouches[0];
    const endTouchPosition = new THREE.Vector2(endTouch.pageX, endTouch.pageY);
    if (initialTouchPosition && initialTouchPosition.distanceTo(endTouchPosition) < 10) { // And small movement
      
      // Check if tap was on a UI element first (redundant if onTouchStart handles it, but safe)
      let targetElement = endTouch.target;
      let ignoreTap = false;
      while (targetElement != null) {
          if (targetElement.dataset && targetElement.dataset.ignoreTap === "true") {
              ignoreTap = true;
              break;
          }
          targetElement = targetElement.parentElement;
      }

      if (!ignoreTap) {
          handleARScreenTap(endTouch);
      }
    }
  }

  // Reset states
  if (event.touches.length < 3) {
    threeFingerMoving = false;
    initialThreeFingerY = null;
  }
  if (event.touches.length < 2) {
    pinchScaling = false;
    pinchRotating = false;
    initialPinchDistance = null;
    initialPinchAngle = null;
    if (selectedPlacedObject) {
      currentBaseScale = selectedPlacedObject.scale.x; // Finalize scale after pinch
    }
  }
  if (event.touches.length < 1) {
    moving = false;
    initialTouchPosition = null;
  }
}

function handleARScreenTap(touchEvent) {
    // Normalize touch position to -1 to +1 range
    tapPosition.x = (touchEvent.clientX / window.innerWidth) * 2 - 1;
    tapPosition.y = -(touchEvent.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(tapPosition, camera);
    const intersects = raycaster.intersectObjects(placedObjects, true); // Recursive check

    if (intersects.length > 0) {
        let tappedObjectRoot = intersects[0].object;
        // Traverse up to find the main group/object that was added to placedObjects
        while (tappedObjectRoot.parent && tappedObjectRoot.parent !== scene) {
            if (placedObjects.includes(tappedObjectRoot.parent)) {
                tappedObjectRoot = tappedObjectRoot.parent;
                break;
            }
            tappedObjectRoot = tappedObjectRoot.parent;
        }
        
        if (placedObjects.includes(tappedObjectRoot)) {
            selectObject(tappedObjectRoot);
        } else { // Tapped on part of an object not directly in placedObjects - might be an error or complex model
            console.warn("Tapped object part not found in root placedObjects array.");
            deselectCurrentObject();
        }
    } else {
        // Tapped on empty space
        deselectCurrentObject();
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

function disposeObject(object) {
    if (!object) return;
    object.traverse(child => {
        if (child.isMesh) {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(material => disposeMaterial(material));
                } else {
                    disposeMaterial(child.material);
                }
            }
        }
    });
}

function disposeMaterial(material) {
    material.dispose(); // General dispose
    // Dispose textures
    for (const key of Object.keys(material)) {
        const value = material[key];
        if (value && typeof value === 'object' && value.isTexture) {
            value.dispose();
        }
    }
}
