import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ARButton } from "three/examples/jsm/webxr/ARButton.js";
import "./qr.js"; // Assuming qr.js is necessary for your setup

import "./style.css";

let container;
let camera, scene, renderer;
let controller;

let reticle;
// let flowersGltf, treesGltf; // Unused, removed

let object1, object2, object3, object4, object5; // To store loaded GLTF scenes

let hitTestSource = null;
let hitTestSourceRequested = false;
let planeFound = false;

const DEFAULT_OBJECT_SCALE = 0.2; // Adjust this for a good default size for your models
let currentScale = DEFAULT_OBJECT_SCALE;
let lastPlacedObject = null;

let selectedObject = "obj1"; // Default selected object

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
let initialZPosition = null; // Will store object's initial Y for Z-move
let initialThreeFingerY = null; // Screen Y for Z-move gesture

// Check for WebXR session support
if ("xr" in navigator) {
  navigator.xr.isSessionSupported("immersive-ar").then((supported) => {
    if (supported) {
      document.getElementById("ar-not-supported").style.display = "none";
      init();
      animate();
    } else {
      // Handle case where AR is not supported on the device
      document.getElementById("ar-not-supported").innerHTML =
        "Immersive AR not supported on this device. Try on a compatible mobile device.";
      // Optionally hide AR specific UI if not supported
      const arButton = ARButton.createButton(renderer, {}); // Create a dummy button to potentially hide later
      arButton.style.display = "none"; // Hide if AR not supported
    }
  }).catch((err) => {
    console.error("Error checking AR support:", err);
    document.getElementById("ar-not-supported").innerHTML =
      "Error checking AR support.";
  });
} else {
  document.getElementById("ar-not-supported").innerHTML =
    "WebXR API not found in navigator. Try a modern browser with WebXR support.";
}


function sessionStart() {
  planeFound = false;
  document.getElementById("tracking-prompt").style.display = "block";
  document.getElementById("instructions").style.display = "none"; // Hide instructions until plane found
  document.getElementById("button-container").style.display = "none"; // Hide buttons until plane found
}

function init() {
  container = document.createElement("div");
  document.body.appendChild(container);

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.01,
    20
  );

  const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
  light.position.set(0.5, 1, 0.25);
  scene.add(light);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  container.appendChild(renderer.domElement);

  renderer.xr.addEventListener("sessionstart", sessionStart);

  document.body.appendChild(
    ARButton.createButton(renderer, {
      requiredFeatures: ["local", "hit-test", "dom-overlay"],
      domOverlay: { root: document.querySelector("#overlay") },
    })
  );

  document.getElementById("place-object-btn").addEventListener("click", onSelect);

  document.getElementById("delete-object-btn").addEventListener("click", () => {
    if (lastPlacedObject) {
      scene.remove(lastPlacedObject);
      lastPlacedObject.traverse(child => { // Dispose geometry and material if they exist
        if (child.isMesh) {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(material => material.dispose());
                } else {
                    child.material.dispose();
                }
            }
        }
      });
      document.getElementById("delete-object-btn").style.display = "none";
      lastPlacedObject = null;
      currentScale = DEFAULT_OBJECT_SCALE; // Reset scale for the next object
    }
  });

  // Object selection buttons
  document.getElementById("object1").addEventListener("click", (event) => {
    event.stopPropagation();
    selectedObject = "obj1";
  });
  document.getElementById("object2").addEventListener("click", (event) => {
    event.stopPropagation();
    selectedObject = "obj2";
  });
  document.getElementById("object3").addEventListener("click", (event) => {
    event.stopPropagation();
    selectedObject = "obj3";
  });
  document.getElementById("object4").addEventListener("click", (event) => {
    event.stopPropagation();
    selectedObject = "obj4";
  });
  document.getElementById("object5").addEventListener("click", (event) => {
    event.stopPropagation();
    selectedObject = "obj5";
  });

  function onSelect() {
    if (reticle.visible) {
      let modelToClone;
      if (selectedObject === "obj1" && object1) {
        modelToClone = object1;
      } else if (selectedObject === "obj2" && object2) {
        modelToClone = object2;
      } else if (selectedObject === "obj3" && object3) {
        modelToClone = object3;
      } else if (selectedObject === "obj4" && object4) {
        modelToClone = object4;
      } else if (selectedObject === "obj5" && object5) {
        modelToClone = object5;
      }

      if (modelToClone) {
        const mesh = modelToClone.clone(); // Clone the entire GLTF scene
        document.getElementById("delete-object-btn").style.display = "flex";

        const newPosition = new THREE.Vector3();
        const newQuaternion = new THREE.Quaternion();
        const tempScale = new THREE.Vector3(); // To absorb scale from decompose, but we won't use it

        reticle.matrix.decompose(newPosition, newQuaternion, tempScale);

        mesh.position.copy(newPosition);
        mesh.quaternion.copy(newQuaternion);

        // Set the scale using currentScale (which defaults to DEFAULT_OBJECT_SCALE)
        mesh.scale.set(currentScale, currentScale, currentScale);

        // Make the object look towards the camera but flat on the recognized plane
        const cameraForward = new THREE.Vector3();
        camera.getWorldDirection(cameraForward);
        const lookAtPosition = new THREE.Vector3(
            camera.position.x,
            mesh.position.y, // Keep object's Y to stay on the plane
            camera.position.z
        );
        mesh.lookAt(lookAtPosition);
        // mesh.rotateY(Math.random() * Math.PI * 2); // Optional: if you want random initial rotation

        scene.add(mesh);
        if (lastPlacedObject) { // Remove previous object if one exists
             scene.remove(lastPlacedObject);
             // Potentially dispose previous object's resources here if memory becomes an issue with many placements
        }
        lastPlacedObject = mesh;

        // --- PLACEMENT ANIMATION (Pop-in effect) ---
        const targetScale = currentScale;
        const startAnimScaleFactor = 0.1; // Start at 10% of target scale

        mesh.scale.set(
          targetScale * startAnimScaleFactor,
          targetScale * startAnimScaleFactor,
          targetScale * startAnimScaleFactor
        );

        const animationDuration = 300; // milliseconds
        const startTime = performance.now();

        function animateEntry() {
          if (!mesh.parent) return; // Stop if object was removed

          const elapsedTime = performance.now() - startTime;
          if (elapsedTime >= animationDuration) {
            mesh.scale.set(targetScale, targetScale, targetScale);
            return;
          }

          const progress = elapsedTime / animationDuration;
          const easedProgress = 1 - Math.pow(1 - progress, 3); // easeOutCubic

          const newAnimScale = targetScale * startAnimScaleFactor + targetScale * (1 - startAnimScaleFactor) * easedProgress;
          mesh.scale.set(newAnimScale, newAnimScale, newAnimScale);

          requestAnimationFrame(animateEntry);
        }
        requestAnimationFrame(animateEntry);
      }
    }
  }

  controller = renderer.xr.getController(0);
  // controller.addEventListener('select', onSelect); // If you want tap screen to place
  scene.add(controller);

  reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.075, 0.1, 16).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }) // Made reticle a bit more visible
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  // GLTF Loading with error handling
  const gltfLoader = new GLTFLoader();
  const textureLoader = new THREE.TextureLoader();

  gltfLoader.load("Shelf.glb", (gltf) => {
    object1 = gltf.scene;
    // You can traverse and apply specific materials or transformations here if needed
    // e.g., object1.scale.set(0.1, 0.1, 0.1); if the model is too large by default
  }, undefined, (error) => console.error('Error loading Shelf.glb:', error));

  const shelfTexture = textureLoader.load("Shelf.png", undefined, undefined, (err) => console.error("Failed to load Shelf.png", err));
  shelfTexture.flipY = false;
  gltfLoader.load("Shelf2.glb", (gltf) => {
    object2 = gltf.scene;
    object2.traverse(node => {
      if (node.isMesh) {
        const newMaterial = node.material.clone(); // Clone to avoid sharing material instance issues
        newMaterial.map = shelfTexture;
        newMaterial.needsUpdate = true;
        node.material = newMaterial;
      }
    });
  }, undefined, (error) => console.error('Error loading Shelf2.glb:', error));

  const bagTexture = textureLoader.load("Map1.png", undefined, undefined, (err) => console.error("Failed to load Map1.png", err));
  bagTexture.flipY = false;
  gltfLoader.load("Bag1.glb", (gltf) => {
    object3 = gltf.scene;
    object3.traverse(node => {
      if (node.isMesh) {
        const newMaterial = node.material.clone();
        newMaterial.map = bagTexture;
        newMaterial.needsUpdate = true;
        node.material = newMaterial;
        }
    });
  }, undefined, (error) => console.error('Error loading Bag1.glb:', error));

  const bagTexture2 = textureLoader.load("Map2.jpg", undefined, undefined, (err) => console.error("Failed to load Map2.jpg", err));
  bagTexture2.flipY = false;
  gltfLoader.load("Bag2.glb", (gltf) => {
    object4 = gltf.scene;
    object4.traverse(node => {
      if (node.isMesh) {
        const newMaterial = node.material.clone();
        newMaterial.map = bagTexture2;
        newMaterial.needsUpdate = true;
        node.material = newMaterial;
      }
    });
  }, undefined, (error) => console.error('Error loading Bag2.glb:', error));

  const bagTexture3 = textureLoader.load("Map3.png", undefined, undefined, (err) => console.error("Failed to load Map3.png", err));
  bagTexture3.flipY = false;
  gltfLoader.load("Bag3.glb", (gltf) => {
    object5 = gltf.scene;
    object5.traverse(node => {
      if (node.isMesh) {
        const newMaterial = node.material.clone();
        newMaterial.map = bagTexture3;
        newMaterial.needsUpdate = true;
        node.material = newMaterial;
      }
    });
  }, undefined, (error) => console.error('Error loading Bag3.glb:', error));


  window.addEventListener("resize", onWindowResize);

  window.addEventListener("touchstart", onTouchStart, { passive: false }); // passive: false if preventDefault is used
  window.addEventListener("touchmove", onTouchMove, { passive: false });
  window.addEventListener("touchend", onTouchEnd, false);
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

    if (hitTestSourceRequested === false && session) { // Check if session exists
      session.requestReferenceSpace("viewer").then(function (refSpace) {
        session
          .requestHitTestSource({ space: refSpace })
          .then(function (source) {
            hitTestSource = source;
          })
          .catch(err => console.error("Error requesting hit test source:", err));
      }).catch(err => console.error("Error requesting viewer reference space:", err));

      session.addEventListener("end", function () {
        hitTestSourceRequested = false;
        hitTestSource = null;
        planeFound = false; // Reset planeFound on session end
        document.getElementById("tracking-prompt").style.display = "none";
        document.getElementById("instructions").style.display = "none";
        document.getElementById("button-container").style.display = "none";
        if(lastPlacedObject) {
            scene.remove(lastPlacedObject); // Clean up object on session end
            lastPlacedObject = null;
        }
      });

      hitTestSourceRequested = true;
    }

    if (hitTestSource) {
      const hitTestResults = frame.getHitTestResults(hitTestSource);

      if (hitTestResults.length) {
        if (!planeFound) {
          planeFound = true;
          document.getElementById("tracking-prompt").style.display = "none";
          document.getElementById("instructions").style.display = "flex";
          document.getElementById("button-container").style.display = "flex";
        }
        const hit = hitTestResults[0];
        if (hit && hit.getPose && referenceSpace) { // Add checks for hit and getPose
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

      } else {
        reticle.visible = false;
      }
    }
  }

  renderer.render(scene, camera);
}

function onTouchStart(event) {
  // Prevent default browser actions for touch events on the canvas, like scrolling
  if (event.target === renderer.domElement || event.target.tagName === 'CANVAS') {
    // event.preventDefault(); // Uncomment if you experience unwanted scrolling/zooming.
                             // Be careful as this might interfere with LaunchAR's overlay.
  }

  if (event.touches.length === 3 && lastPlacedObject) {
    threeFingerMoving = true;
    initialZPosition = lastPlacedObject.position.y;
    initialThreeFingerY = event.touches[0].pageY;
    // Disable other gestures
    pinchScaling = false;
    pinchRotating = false;
    moving = false;
  } else if (event.touches.length === 2 && lastPlacedObject) {
    pinchScaling = true;
    pinchRotating = true;
    initialPinchDistance = getPinchDistance(event.touches);
    initialPinchAngle = getPinchAngle(event.touches);
    // Update currentScale here to be the scale *before* this new pinch starts
    currentScale = lastPlacedObject.scale.x; // Assuming uniform scaling
    // Disable other gestures
    moving = false;
    threeFingerMoving = false;
  } else if (event.touches.length === 1 && lastPlacedObject) {
    moving = true;
    initialTouchPosition = new THREE.Vector2(event.touches[0].pageX, event.touches[0].pageY);
    // Disable other gestures
    pinchScaling = false;
    pinchRotating = false;
    threeFingerMoving = false;
  }
}

function onTouchMove(event) {
  if (event.target === renderer.domElement || event.target.tagName === 'CANVAS') {
    // event.preventDefault(); // See note in onTouchStart
  }

  if (event.touches.length === 3 && threeFingerMoving && lastPlacedObject) {
    const deltaY = initialThreeFingerY - event.touches[0].pageY;
    const moveAmount = deltaY * 0.005; // Adjusted sensitivity for Z movement
    lastPlacedObject.position.y = initialZPosition + moveAmount;
  } else if (event.touches.length === 2 && lastPlacedObject) {
    if (pinchScaling) {
      const newPinchDistance = getPinchDistance(event.touches);
      const scaleChange = newPinchDistance / initialPinchDistance;
      // currentScale here is the scale *before* this pinch started
      const newObjectScale = currentScale * scaleChange;
      lastPlacedObject.scale.set(newObjectScale, newObjectScale, newObjectScale);
    }

    if (pinchRotating) {
      const newPinchAngle = getPinchAngle(event.touches);
      const angleChange = newPinchAngle - initialPinchAngle;
      lastPlacedObject.rotation.y += angleChange;
      initialPinchAngle = newPinchAngle; // Update for continuous rotation
    }
  } else if (event.touches.length === 1 && moving && lastPlacedObject) {
    const currentTouchPosition = new THREE.Vector2(event.touches[0].pageX, event.touches[0].pageY);
    const deltaX = (currentTouchPosition.x - initialTouchPosition.x) * 0.002; // Sensitivity
    const deltaZ = (currentTouchPosition.y - initialTouchPosition.y) * 0.002; // Sensitivity, Y screen swipe moves along Z world

    // Create a movement vector in camera space (X is left/right, Z is forward/backward)
    const moveVector = new THREE.Vector3(-deltaX, 0, -deltaZ);

    // Transform the movement vector from camera space to world space
    moveVector.applyQuaternion(camera.quaternion);

    // Apply the transformed movement vector to the object's position
    // We only want to move on the XZ plane relative to the world
    lastPlacedObject.position.x += moveVector.x;
    lastPlacedObject.position.z += moveVector.z;

    initialTouchPosition.copy(currentTouchPosition);
  }
}

function onTouchEnd(event) {
  if (event.touches.length < 3) {
    threeFingerMoving = false;
  }
  if (event.touches.length < 2) {
    if (pinchScaling || pinchRotating) { // Only update currentScale if a pinch/rotate was active
        if (lastPlacedObject) {
            currentScale = lastPlacedObject.scale.x; // Update currentScale to the object's final scale
        }
    }
    pinchScaling = false;
    pinchRotating = false;
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