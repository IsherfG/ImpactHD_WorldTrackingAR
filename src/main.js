import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ARButton } from "three/examples/jsm/webxr/ARButton.js";
import "./qr.js";

import "./style.css";

let container;
let camera, scene, renderer;
let controller;

let reticle;
// let flowersGltf, treesGltf; // These seem unused, commented out for clarity
let object1, object2, object3, object4, object5; // Declare GLTF model variables

let hitTestSource = null;
let hitTestSourceRequested = false;
let planeFound = false;

let currentScale = 1;
let lastPlacedObject = null;

let selectedObject = "flower"; // Default selected object

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
let initialZPosition = null;
let initialThreeFingerY = null;

// Check for WebXR session support
if ("xr" in navigator) {
  navigator.xr.isSessionSupported("immersive-ar").then((supported) => {
    if (supported) {
      document.getElementById("ar-not-supported").style.display = "none";
      init();
      animate();
    } else {
      // Handle AR not supported case, e.g., show a message
      console.warn("Immersive AR session not supported by this browser/device.");
      document.getElementById("ar-not-supported").textContent =
        "AR is not supported on this device or browser. Please try a compatible browser like Chrome on Android.";
      document.getElementById("ar-not-supported").style.display = "block";
    }
  });
} else {
    console.warn("WebXR API not available in this browser.");
    document.getElementById("ar-not-supported").textContent =
        "WebXR API is not available in this browser. Please try a compatible browser like Chrome on Android.";
    document.getElementById("ar-not-supported").style.display = "block";
}

function sessionStart() {
  planeFound = false;
  document.getElementById("tracking-prompt").style.display = "block";
  document.getElementById("instructions").style.display = "none";
  document.getElementById("button-container").style.display = "none";
  document.getElementById("delete-object-btn").style.display = "none";

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

  const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1.5); // Increased intensity slightly
  light.position.set(0.5, 1, 0.25);
  scene.add(light);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5); // Add some ambient light
  scene.add(ambientLight);


  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  container.appendChild(renderer.domElement);

  renderer.xr.addEventListener("sessionstart", sessionStart);

  document.body.appendChild(
    ARButton.createButton(renderer, {
      requiredFeatures: ["local", "hit-test", "dom-overlay"], // 'local' is often default, 'local-floor' might be better
      domOverlay: { root: document.querySelector("#overlay") },
    })
  );

  document.getElementById("place-object-btn").addEventListener("click", onSelect);


  document.getElementById("delete-object-btn").addEventListener("click", () => {
    if (lastPlacedObject) {
      scene.remove(lastPlacedObject);
      lastPlacedObject.traverse(child => { // Ensure proper disposal
        if (child.isMesh) {
            child.geometry.dispose();
            if (child.material.isMaterial) {
                cleanMaterial(child.material);
            } else {
                // For an array of materials, cycle through each of them
                for (const material of child.material) {
                    cleanMaterial(material);
                }
            }
        }
      });
      document.getElementById("delete-object-btn").style.display = "none"
      lastPlacedObject = null;
      currentScale = 1;
    }
  });

  // Helper function to dispose of material and its textures
  function cleanMaterial(material) {
    material.dispose();
    // Dispose textures
    for (const key of Object.keys(material)) {
        const value = material[key];
        if (value && typeof value === 'object' && 'isTexture' in value) {
            value.dispose();
        }
    }
  }


  document.getElementById("object1").addEventListener("click", (event) => {
    event.stopPropagation();
    selectedObject = "obj1";
    console.log("Selected obj1");
  });
  document.getElementById("object2").addEventListener("click", (event) => {
    event.stopPropagation();
    selectedObject = "obj2";
    console.log("Selected obj2");
  });
  document.getElementById("object3").addEventListener("click", (event) => {
    event.stopPropagation();
    selectedObject = "obj3";
    console.log("Selected obj3");
  });
  document.getElementById("object4").addEventListener("click", (event) => {
    event.stopPropagation();
    selectedObject = "obj4";
    console.log("Selected obj4");
  });
  document.getElementById("object5").addEventListener("click", (event) => {
    event.stopPropagation();
    selectedObject = "obj5";
    console.log("Selected obj5");
  });

  function onSelect() {
    if (reticle.visible) {
      let mesh;
      let sourceObject;

      if (selectedObject === "obj1" && object1) {
        sourceObject = object1;
      } else if (selectedObject === "obj2" && object2) {
        sourceObject = object2;
      } else if (selectedObject === "obj3" && object3) {
        sourceObject = object3;
      } else if (selectedObject === "obj4" && object4) {
        sourceObject = object4;
      } else if (selectedObject === "obj5" && object5) {
        sourceObject = object5;
      }

      if (sourceObject) {
        // If sourceObject.children exists and is not empty, pick a random child.
        // Otherwise, clone the sourceObject itself (assuming it's a Group or Mesh).
        if (sourceObject.children && sourceObject.children.length > 0) {
            const randomChild = sourceObject.children[
                Math.floor(Math.random() * sourceObject.children.length)
            ];
            if (randomChild) mesh = randomChild.clone();
        } else {
            mesh = sourceObject.clone();
        }

      } else {
        console.warn("Selected object model not loaded yet:", selectedObject);
        return;
      }


      if (mesh) {
        // If there's an existing object, remove it first
        if (lastPlacedObject) {
            scene.remove(lastPlacedObject);
             lastPlacedObject.traverse(child => { // Ensure proper disposal
                if (child.isMesh) {
                    child.geometry.dispose();
                     if (child.material.isMaterial) {
                        cleanMaterial(child.material);
                    } else {
                        for (const material of child.material) {
                            cleanMaterial(material);
                        }
                    }
                }
            });
        }


        document.getElementById("delete-object-btn").style.display = "flex"
        // mesh.scale.set(currentScale, currentScale, currentScale); // Apply initial scale
        reticle.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale); // Set position and rotation from reticle

        // Set initial scale for new objects, don't use the reticle's decomposed scale for the object's own scale.
        mesh.scale.set(1, 1, 1).multiplyScalar(currentScale); // Start with currentScale

        // Orient object to face the camera initially, but flat on the detected plane
        const cameraPosition = new THREE.Vector3();
        camera.getWorldPosition(cameraPosition);
        // Project camera position onto the plane of the object for lookAt
        const lookAtPosition = new THREE.Vector3(cameraPosition.x, mesh.position.y, cameraPosition.z);
        mesh.lookAt(lookAtPosition);

        // Optional: Add a random Y rotation if desired for variation
        // mesh.rotateY(Math.random() * Math.PI * 2);

        scene.add(mesh);
        lastPlacedObject = mesh;

        // "Pop-in" animation
        const targetScale = mesh.scale.clone();
        mesh.scale.set(0.01, 0.01, 0.01); // Start very small
        let animTime = 0;
        const animDuration = 0.3; // 300ms animation
        const popInInterval = setInterval(() => {
            animTime += 16/1000; // approximately 16ms per frame
            const progress = Math.min(animTime / animDuration, 1);
            const easeOutProgress = 1 - Math.pow(1 - progress, 3); // Ease-out cubic

            mesh.scale.set(
                0.01 + (targetScale.x - 0.01) * easeOutProgress,
                0.01 + (targetScale.y - 0.01) * easeOutProgress,
                0.01 + (targetScale.z - 0.01) * easeOutProgress
            );

            // mesh.rotateY(0.03 * easeOutProgress); // Optional rotation during pop-in

            if (progress >= 1) {
                clearInterval(popInInterval);
                mesh.scale.copy(targetScale); // Ensure final scale is exact
            }
        }, 16);

      }
    }
  }

  controller = renderer.xr.getController(0);
  // controller.addEventListener('select', onSelect); // Keep this if you want tap-to-place via controller
  scene.add(controller);

  reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.075, 0.1, 32).rotateX(-Math.PI / 2), // Increased segments for smoother ring
    new THREE.MeshBasicMaterial({ color: 0x007bff, opacity: 0.75, transparent: true }) // Changed color and added opacity
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  const gltfLoader = new GLTFLoader(); // Use one loader instance

  gltfLoader.load("Shelf.glb", (gltf) => {
    object1 = gltf.scene;
    object1.scale.set(0.1, 0.1, 0.1); // Example initial scale adjustment
    console.log("Shelf.glb (object1) loaded");
  }, undefined, (error) => console.error("Error loading Shelf.glb", error));

  const textureLoaderShelf = new THREE.TextureLoader()
  const shelfTexture = textureLoaderShelf.load("Shelf.png")
  shelfTexture.flipY = false;
  shelfTexture.colorSpace = THREE.SRGBColorSpace; // Important for correct color

  gltfLoader.load("Shelf2.glb", (gltf) => {
    object2 = gltf.scene;
    object2.scale.set(0.1, 0.1, 0.1); // Example initial scale adjustment
    object2.traverse(node => {
      if (node.isMesh && node.material) {
        node.material.map = shelfTexture;
        node.material.needsUpdate = true; // Important
      }
    });
    console.log("Shelf2.glb (object2) loaded");
  }, undefined, (error) => console.error("Error loading Shelf2.glb", error));

  const textureLoader = new THREE.TextureLoader()
  const bagTexture = textureLoader.load("Map1.png")
  bagTexture.flipY = false;
  bagTexture.colorSpace = THREE.SRGBColorSpace;

  gltfLoader.load("Bag1.glb", (gltf) => {
    object3 = gltf.scene;
    object3.scale.set(0.2, 0.2, 0.2); // Example initial scale adjustment
    object3.traverse(node => {
      if (node.isMesh && node.material) {
        node.material.map = bagTexture;
        node.material.needsUpdate = true;
      }
    });
    console.log("Bag1.glb (object3) loaded");
  }, undefined, (error) => console.error("Error loading Bag1.glb", error));

  const textureLoader2 = new THREE.TextureLoader()
  const bagTexture2 = textureLoader2.load("Map2.jpg")
  bagTexture2.flipY = false;
  bagTexture2.colorSpace = THREE.SRGBColorSpace;

  gltfLoader.load("Bag2.glb", (gltf) => {
    object4 = gltf.scene;
    object4.scale.set(0.2, 0.2, 0.2); // Example initial scale adjustment
    object4.traverse(node => {
      if (node.isMesh && node.material) {
        node.material.map = bagTexture2;
        node.material.needsUpdate = true;
      }
    });
    console.log("Bag2.glb (object4) loaded");
  }, undefined, (error) => console.error("Error loading Bag2.glb", error));

  const textureLoader3 = new THREE.TextureLoader()
  const bagTexture3 = textureLoader3.load("Map3.png")
  bagTexture3.flipY = false;
  bagTexture3.colorSpace = THREE.SRGBColorSpace;

  gltfLoader.load("Bag3.glb", (gltf) => {
    object5 = gltf.scene;
    object5.scale.set(0.2, 0.2, 0.2); // Example initial scale adjustment
    object5.traverse(node => {
      if (node.isMesh && node.material) {
        node.material.map = bagTexture3;
        node.material.needsUpdate = true;
      }
    });
    console.log("Bag3.glb (object5) loaded");
  }, undefined, (error) => console.error("Error loading Bag3.glb", error));


  window.addEventListener("resize", onWindowResize);

  // Use the DOM overlay for touch events if available and an AR session is active
  // This helps in correctly mapping touch coordinates.
  const overlayElement = document.querySelector("#overlay");

  overlayElement.addEventListener("touchstart", onTouchStart, { passive: false }); // passive: false to allow preventDefault if needed
  overlayElement.addEventListener("touchmove", onTouchMove, { passive: false });
  overlayElement.addEventListener("touchend", onTouchEnd, false);
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

    if (!session) return; // Exit if session is not active

    if (hitTestSourceRequested === false) {
      session.requestReferenceSpace("viewer").then((viewerSpace) => {
        session
          .requestHitTestSource({ space: viewerSpace })
          .then((source) => {
            hitTestSource = source;
          })
          .catch(err => console.error("Failed to request hit test source:", err));
      });

      session.addEventListener("end", () => {
        hitTestSourceRequested = false;
        hitTestSource = null;
        // Reset UI elements or state as needed
        planeFound = false;
        document.getElementById("tracking-prompt").style.display = "block"; // Or based on session state
        document.getElementById("instructions").style.display = "none";
        document.getElementById("button-container").style.display = "none";
        if (reticle) reticle.visible = false;
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
    }
  }

  renderer.render(scene, camera);
}

function onTouchStart(event) {
  // Prevent browser default actions for touch, like scrolling or zooming page
  // event.preventDefault(); // Be cautious with this, might interfere with ARButton or other UI

  if (!lastPlacedObject && event.touches.length === 1) {
    // If no object is placed, a single tap might be intended to place one via onSelect
    // if the reticle is visible (handled by place-object-btn or controller select for now)
    // Or, if you want direct tap-to-place without the button:
    // if (reticle.visible) {
    //   onSelect();
    // }
    return;
  }

  if (!lastPlacedObject) return; // No interactions if no object is placed

  if (event.touches.length === 3) {
    threeFingerMoving = true;
    initialZPosition = lastPlacedObject.position.y;
    initialThreeFingerY = event.touches[0].pageY; // Use average or first touch
  } else if (event.touches.length === 2) {
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
  // event.preventDefault(); // Be cautious

  if (!lastPlacedObject) return;

  if (event.touches.length === 3 && threeFingerMoving) {
    const currentThreeFingerY = event.touches[0].pageY; // Or average
    const deltaY = initialThreeFingerY - currentThreeFingerY; // Drag up = positive deltaY

    // Sensitivity factor for vertical movement
    const moveAmount = deltaY * 0.005; // Adjust sensitivity as needed

    lastPlacedObject.position.y = initialZPosition + moveAmount;
    // initialZPosition and initialThreeFingerY are set in onTouchStart and remain constant for the drag
    // For continuous update:
    // lastPlacedObject.position.y += deltaY * SENSITIVITY_FACTOR;
    // initialThreeFingerY = currentThreeFingerY; // Update for next frame's delta calculation

  } else if (event.touches.length === 2 && (pinchScaling || pinchRotating)) {
    const newPinchDistance = getPinchDistance(event.touches);
    const newPinchAngle = getPinchAngle(event.touches);

    if (pinchScaling && initialPinchDistance !== null && initialPinchDistance > 0) {
      const scaleChange = newPinchDistance / initialPinchDistance;
      // Apply scale change relative to the scale at the START of the pinch (currentScale)
      const newScaleValue = currentScale * scaleChange;
      lastPlacedObject.scale.set(newScaleValue, newScaleValue, newScaleValue);
    }

    if (pinchRotating && initialPinchAngle !== null) {
      const angleChange = newPinchAngle - initialPinchAngle;
      lastPlacedObject.rotation.y += angleChange;
      initialPinchAngle = newPinchAngle; // Update for continuous rotation
    }
  } else if (event.touches.length === 1 && moving) {
    const currentTouchPosition = new THREE.Vector2(event.touches[0].pageX, event.touches[0].pageY);

    // screenDeltaX > 0 for dragging right on screen.
    // screenDeltaY > 0 for dragging down on screen.
    // Normalizing by window dimensions helps make sensitivity somewhat consistent
    // But for AR, the perceived movement also depends on distance to object.
    const screenDeltaX = (currentTouchPosition.x - initialTouchPosition.x) / window.innerWidth;
    const screenDeltaY = (currentTouchPosition.y - initialTouchPosition.y) / window.innerHeight;

    // Create a movement vector in the camera's local coordinate system.
    // Dragging right (screenDeltaX > 0) -> object moves to camera's right (+X in camera local space).
    // Dragging up   (screenDeltaY < 0) -> object moves away from camera (-Z in camera local space).
    // Dragging down (screenDeltaY > 0) -> object moves towards camera (+Z in camera local space).
    const moveVector = new THREE.Vector3(screenDeltaX, 0, screenDeltaY);

    // Transform this camera-local movement vector into a world-space direction.
    moveVector.applyQuaternion(camera.quaternion);

    // Ensure movement is horizontal in world space (on the AR plane).
    moveVector.y = 0;
    moveVector.normalize(); // Normalize to get a direction vector

    // Apply a sensitivity factor. This value might need tuning.
    const moveSensitivity = 0.5; // Adjust this to control speed
    moveVector.multiplyScalar(moveSensitivity * (Math.abs(screenDeltaX) + Math.abs(screenDeltaY))); // Scale by magnitude of drag


    lastPlacedObject.position.add(moveVector);

    initialTouchPosition.copy(currentTouchPosition);
  }
}

function onTouchEnd(event) {
  // No event.preventDefault() here typically

  if (threeFingerMoving && event.touches.length < 3) {
    threeFingerMoving = false;
    initialZPosition = null; // Reset
    initialThreeFingerY = null;
  }
  if ((pinchScaling || pinchRotating) && event.touches.length < 2) {
    pinchScaling = false;
    pinchRotating = false;
    initialPinchDistance = null; // Reset
    initialPinchAngle = null;
    if (lastPlacedObject) {
      currentScale = lastPlacedObject.scale.x; // Update currentScale to the new scale
    }
  }
  if (moving && event.touches.length < 1) {
    moving = false;
    initialTouchPosition = null; // Reset
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