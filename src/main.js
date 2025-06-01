import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ARButton } from "three/examples/jsm/webxr/ARButton.js";
// import "./qr.js"; // Assuming this is not essential for the core AR functionality for now

// import "./style.css"; // CSS is linked in HTML

let container;
let camera, scene, renderer;
let controller;
let reticle;

let object1, object2, object3, object4, object5; // GLTF model scenes

let hitTestSource = null;
let hitTestSourceRequested = false;
let planeFound = false;

let currentScale = 0.2; // IMPORTANT: Adjust this for your models' default size!
let lastPlacedObject = null;
let selectedObjectGLTF = null; // This will hold the GLTF scene to be cloned
const DRAG_SENSITIVITY = 0.7; // Adjust for 1-finger drag speed

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
let initialZPosition = null; // This will be object's Y
let initialThreeFingerY = null; // This will be touch Y on screen

// Lights
let ambientLight, directionalLight;

// Check for WebXR session support
if ("xr" in navigator) {
  navigator.xr.isSessionSupported("immersive-ar").then((supported) => {
    document.getElementById("app").style.display = supported ? "none" : "flex";
    if (supported) {
      init();
      animate();
    } else {
      document.getElementById("ar-not-supported").innerHTML =
        "AR not supported on this browser/device. Try Chrome on Android or Safari on iOS.";
    }
  });
} else {
  document.getElementById("app").style.display = "flex";
  document.getElementById("ar-not-supported").innerHTML =
    "WebXR API not found. Your browser may be outdated or not support WebXR.";
}

function sessionStart() {
  planeFound = false;
  document.getElementById("tracking-prompt").style.display = "block";
  document.getElementById("instructions").style.display = "none";
  document.getElementById("button-container").style.display = "none";
  document.getElementById("app").style.display = "none"; // Hide non-AR UI

  // Request light estimation updates if available
  const session = renderer.xr.getSession();
  if (session && typeof session.updateWorldLight === 'function') {
      session.updateWorldLight({
          reflectionCubeMap: null, // Set to true or a cubemap if you want reflections
      }).catch(err => console.warn("Light estimation update failed:", err));
  }
}

function init() {
  container = document.createElement("div");
  document.body.appendChild(container);

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.01,
    100 // Increased far plane for larger scenes / shadows
  );

  // --- Lights ---
  ambientLight = new THREE.AmbientLight(0xffffff, 0.6); // Softer ambient
  scene.add(ambientLight);

  directionalLight = new THREE.DirectionalLight(0xffffff, 0.8); // Main light source
  directionalLight.position.set(1, 2, 1.5); // Initial position
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 1024;
  directionalLight.shadow.mapSize.height = 1024;
  directionalLight.shadow.camera.near = 0.1;
  directionalLight.shadow.camera.far = 50; // Adjust based on scene scale
  directionalLight.shadow.bias = -0.001; // Helps prevent shadow acne
  scene.add(directionalLight);
  scene.add(directionalLight.target); // Important for directional light targeting

  // --- Renderer ---
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Softer shadows
  // renderer.toneMapping = THREE.ACESFilmicToneMapping; // Optional: For better HDR if using PBR
  // renderer.toneMappingExposure = 1;
  container.appendChild(renderer.domElement);

  renderer.xr.addEventListener("sessionstart", sessionStart);
  renderer.xr.addEventListener("sessionend", () => {
      // Show non-AR UI again when session ends
      document.getElementById("app").style.display = "flex";
      document.getElementById("tracking-prompt").style.display = "none";
      document.getElementById("instructions").style.display = "none";
      document.getElementById("button-container").style.display = "none";
      // Clean up scene if needed
      if (lastPlacedObject) {
        scene.remove(lastPlacedObject);
        lastPlacedObject = null;
      }
      // Reset planeFound for next session
      planeFound = false;
      hitTestSourceRequested = false;
      hitTestSource = null;
  });

  const arButton = ARButton.createButton(renderer, {
    requiredFeatures: ["local", "hit-test", "dom-overlay", "light-estimation"],
    domOverlay: { root: document.querySelector("#overlay") },
  });
  // ARButton is typically appended to body by its own script, but we can style it:
  arButton.id = "ARButton"; // Give it an ID for CSS
  document.body.appendChild(arButton);


  document.getElementById("place-object-btn").addEventListener("click", onSelect);

  document.getElementById("delete-object-btn").addEventListener("click", () => {
    if (lastPlacedObject) {
      scene.remove(lastPlacedObject);
      lastPlacedObject = null;
      document.getElementById("delete-object-btn").style.display = "none";
      // currentScale = 0.2; // Optionally reset scale, or keep last used scale
    }
  });

  const objectButtons = [
    { id: "object1", loader: new GLTFLoader(), path: "Shelf.glb", varName: "object1" },
    { id: "object2", loader: new GLTFLoader(), path: "Shelf2.glb", varName: "object2", texturePath: "Shelf.png", flipY: false},
    { id: "object3", loader: new GLTFLoader(), path: "Bag1.glb", varName: "object3", texturePath: "Map1.png", flipY: false },
    { id: "object4", loader: new GLTFLoader(), path: "Bag2.glb", varName: "object4", texturePath: "Map2.jpg", flipY: false },
    { id: "object5", loader: new GLTFLoader(), path: "Bag3.glb", varName: "object5", texturePath: "Map3.png", flipY: false },
  ];

  let modelsLoaded = 0;
  const totalModels = objectButtons.length;

  objectButtons.forEach(objConfig => {
    const button = document.getElementById(objConfig.id);
    button.addEventListener("click", (event) => {
      event.stopPropagation(); // Prevent overlay click-through if any
      if (window[objConfig.varName]) { // Check if model is loaded
        selectedObjectGLTF = window[objConfig.varName];
        // UI feedback for selected button
        document.querySelectorAll("#button-container button").forEach(btn => btn.classList.remove("active"));
        button.classList.add("active");
      } else {
        console.warn(`${objConfig.varName} not loaded yet.`);
      }
    });

    objConfig.loader.load(objConfig.path, (gltf) => {
      window[objConfig.varName] = gltf.scene;
      // Apply textures if specified
      if (objConfig.texturePath) {
        const textureLoader = new THREE.TextureLoader();
        const texture = textureLoader.load(objConfig.texturePath, () => {
            // Optional: callback after texture loads
            renderer.render(scene, camera); // Re-render if texture loaded async after initial render
        }, undefined, (err) => {
            console.error(`Error loading texture ${objConfig.texturePath}:`, err);
        });
        if (objConfig.flipY !== undefined) texture.flipY = objConfig.flipY;
        
        window[objConfig.varName].traverse(node => {
          if (node.isMesh && node.material) {
            // Ensure material is map-compatible (Standard, Physical)
            if (node.material.map !== undefined) {
                node.material.map = texture;
                node.material.needsUpdate = true;
            }
          }
        });
      }

      modelsLoaded++;
      if (modelsLoaded === totalModels) {
        console.log("All models loaded.");
        // Select the first object by default if desired
        if (window[objectButtons[0].varName]) {
            selectedObjectGLTF = window[objectButtons[0].varName];
            document.getElementById(objectButtons[0].id).classList.add("active");
        }
      }
    }, undefined, (error) => {
      console.error(`Error loading ${objConfig.path}:`, error);
    });
  });


  controller = renderer.xr.getController(0); // Not strictly used for screen tap, but good for other inputs
  scene.add(controller);

  reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.075, 0.1, 32).rotateX(-Math.PI / 2), // Increased segments for smoother ring
    new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.7 }) // Make reticle more visible
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  window.addEventListener("resize", onWindowResize);
  window.addEventListener("touchstart", onTouchStart, { passive: false }); // passive:false if preventDefault is used
  window.addEventListener("touchmove", onTouchMove, { passive: false });
  window.addEventListener("touchend", onTouchEnd, { passive: false });
}


function onSelect() { // This is the "Place Object" button's action
  if (reticle.visible && selectedObjectGLTF) {
    const mesh = selectedObjectGLTF.clone(); // Clone the selected GLTF scene

    mesh.traverse(child => {
      if (child.isMesh) {
        child.castShadow = true;
        // child.receiveShadow = true; // Enable if AR objects should cast shadows on each other
        if (child.material) {
            // For transparent parts to cast shadows correctly (if any)
            // child.material.customDepthMaterial = new THREE.MeshDepthMaterial({
            // depthPacking: THREE.RGBADepthPacking,
            // map: child.material.map, // if texture has alpha
            // alphaTest: 0.5 // adjust if needed
            // });
        }
      }
    });

    document.getElementById("delete-object-btn").style.display = "flex";

    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(); // temp
    reticle.matrix.decompose(position, quaternion, scale);

    mesh.position.copy(position);
    // mesh.quaternion.copy(quaternion); // Reticle quaternion often aligns with surface normal.
                                      // You might want object to be upright.
    
    mesh.scale.set(currentScale, currentScale, currentScale);

    // Make object look "away" from camera or stand upright
    const cameraPosition = new THREE.Vector3();
    camera.getWorldPosition(cameraPosition);
    // Option 1: Face away from camera (Y-axis up)
    const lookAtPosition = new THREE.Vector3(cameraPosition.x, mesh.position.y, cameraPosition.z);
    mesh.lookAt(lookAtPosition);
    
    // Option 2: Align with reticle's orientation but ensure Y is up
    // mesh.quaternion.copy(quaternion);
    // const currentEuler = new THREE.Euler().setFromQuaternion(mesh.quaternion, 'YXZ');
    // mesh.quaternion.setFromEuler(new THREE.Euler(0, currentEuler.y, 0, 'YXZ'));


    scene.add(mesh);
    if (lastPlacedObject) { // Remove previous object if you only want one at a time
        scene.remove(lastPlacedObject);
    }
    lastPlacedObject = mesh;

    // No shrinking animation here to maintain currentScale consistency
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

    if (!hitTestSourceRequested && session) {
      session.requestReferenceSpace("viewer").then((viewerSpace) => {
        session.requestHitTestSource({ space: viewerSpace }).then((source) => {
          hitTestSource = source;
        }).catch(err => console.error("Hit test source request failed:", err));
      }).catch(err => console.error("Viewer space request failed:", err));

      session.addEventListener("end", () => {
        hitTestSourceRequested = false;
        hitTestSource = null;
        planeFound = false; // Reset for next session
        document.getElementById("tracking-prompt").style.display = "none";
        document.getElementById("instructions").style.display = "none";
        document.getElementById("button-container").style.display = "none";
      });
      hitTestSourceRequested = true;
    }

    if (hitTestSource) {
      const hitTestResults = frame.getHitTestResults(hitTestSource);
      if (hitTestResults.length > 0) {
        if (!planeFound) {
          planeFound = true;
          document.getElementById("tracking-prompt").style.display = "none";
          document.getElementById("instructions").style.display = "flex";
          document.getElementById("button-container").style.display = "flex";
        }
        const hit = hitTestResults[0];
        reticle.visible = true;
        reticle.matrix.fromArray(hit.getPose(referenceSpace).transform.matrix);
      } else {
        reticle.visible = false;
      }
    }

    // Light Estimation Update
    const lightProbe = frame.lightProbe;
    if (lightProbe && renderer.xr.updateLightEstimation) {
        renderer.xr.updateLightEstimation(lightProbe); // Updates scene.environment primarily
        // Optionally, you could try to adjust your manual lights here too:
        // const estimatedLight = frame.getLightEstimate(lightProbe); // This is an XRWebGLBinding.getLightEstimate
        // if (estimatedLight) {
        //   ambientLight.intensity = estimatedLight.primaryLightIntensity.x * 0.5; // Example
        //   directionalLight.intensity = estimatedLight.primaryLightIntensity.x; // Example
        //   // Convert direction from estimatedLight.primaryLightDirection to world coords for directionalLight
        // }
    }

    // Update directional light to follow camera for more dynamic shadows
    if (directionalLight && lastPlacedObject) { // Only update if an object is placed
        const camPos = new THREE.Vector3();
        camera.getWorldPosition(camPos);
        // Position light somewhat behind and above camera, pointing at object
        directionalLight.position.set(camPos.x + 1, camPos.y + 2, camPos.z + 1);
        directionalLight.target = lastPlacedObject;
    } else if (directionalLight) { // Default target if no object
        const camDir = new THREE.Vector3();
        camera.getWorldDirection(camDir);
        directionalLight.target.position.copy(camera.position).add(camDir.multiplyScalar(2));
    }
    if(directionalLight) directionalLight.target.updateMatrixWorld();


  }
  renderer.render(scene, camera);
}

// --- Touch Event Handlers ---
function onTouchStart(event) {
  // event.preventDefault(); // Can help if page scrolls during gestures

  if (!lastPlacedObject) return; // No interactions if no object is placed

  if (event.touches.length === 3) {
    threeFingerMoving = true;
    initialZPosition = lastPlacedObject.position.y;
    initialThreeFingerY = event.touches[0].pageY; // Use average or first touch
  } else if (event.touches.length === 2) {
    currentScale = lastPlacedObject.scale.x; // IMPORTANT: Update currentScale to actual before pinch
    pinchScaling = true;
    pinchRotating = true;
    initialPinchDistance = getPinchDistance(event.touches);
    initialPinchAngle = getPinchAngle(event.touches);
  } else if (event.touches.length === 1) {
    moving = true;
    initialTouchPosition = new THREE.Vector2(event.touches[0].pageX, event.touches[0].pageY);
  }
}

function onTouchMove(event) {
  // event.preventDefault();

  if (!lastPlacedObject) return;

  if (event.touches.length === 3 && threeFingerMoving) {
    const deltaY = initialThreeFingerY - event.touches[0].pageY;
    const moveAmount = deltaY * 0.005; // Adjust sensitivity for Y-axis movement
    lastPlacedObject.position.y = initialZPosition + moveAmount;
  } else if (event.touches.length === 2 && (pinchScaling || pinchRotating)) {
    const newPinchDistance = getPinchDistance(event.touches);
    const newPinchAngle = getPinchAngle(event.touches);

    if (pinchScaling) {
      const scaleChange = newPinchDistance / initialPinchDistance;
      const newScale = currentScale * scaleChange;
      lastPlacedObject.scale.set(newScale, newScale, newScale);
    }

    if (pinchRotating) {
      const angleChange = newPinchAngle - initialPinchAngle;
      lastPlacedObject.rotation.y += angleChange; // Rotate around Y-axis
      initialPinchAngle = newPinchAngle; // Update for continuous rotation
    }
  } else if (event.touches.length === 1 && moving) {
    const currentTouchPosition = new THREE.Vector2(event.touches[0].pageX, event.touches[0].pageY);
    
    const deltaX = (currentTouchPosition.x - initialTouchPosition.x) / window.innerWidth;
    const deltaY = (currentTouchPosition.y - initialTouchPosition.y) / window.innerHeight;

    const moveVector = new THREE.Vector3(deltaX * DRAG_SENSITIVITY, 0, deltaY * DRAG_SENSITIVITY);

    // Get camera's Y-axis rotation (yaw)
    const cameraQuaternion = new THREE.Quaternion();
    camera.getWorldQuaternion(cameraQuaternion);
    const euler = new THREE.Euler().setFromQuaternion(cameraQuaternion, 'YXZ');
    euler.x = 0; // Ignore pitch
    euler.z = 0; // Ignore roll
    const flatCameraQuaternion = new THREE.Quaternion().setFromEuler(euler);

    moveVector.applyQuaternion(flatCameraQuaternion);
    lastPlacedObject.position.add(moveVector);

    initialTouchPosition.copy(currentTouchPosition);
  }
}

function onTouchEnd(event) {
  if (event.touches.length < 3) {
    threeFingerMoving = false;
  }
  if (event.touches.length < 2) {
    pinchScaling = false;
    pinchRotating = false;
    if (lastPlacedObject) { // Update currentScale only if an object exists
        currentScale = lastPlacedObject.scale.x; // Persist the new scale
    }
  }
  if (event.touches.length < 1) {
    moving = false;
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