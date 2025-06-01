import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ARButton } from "three/examples/jsm/webxr/ARButton.js";
import "./qr.js"; // Assuming qr.js is necessary for your setup

import "./style.css";

let container;
let camera, scene, renderer;
let controller;

let reticle;

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
const MOVE_SENSITIVITY = 0.0025; // Adjusted sensitivity for 1-finger move

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
      document.getElementById("ar-not-supported").innerHTML =
        "Immersive AR not supported on this device. Try on a compatible mobile device.";
      const arButtonElement = document.querySelector("#ARButton"); // Attempt to find ARButton if it has an ID
      if (arButtonElement) arButtonElement.style.display = "none";
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
  document.getElementById("instructions").style.display = "none";
  document.getElementById("button-container").style.display = "none";
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

  const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1.5); // Increased intensity a bit
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

  const arButton = ARButton.createButton(renderer, {
    requiredFeatures: ["local", "hit-test", "dom-overlay"],
    domOverlay: { root: document.querySelector("#overlay") },
  });
  // ARButton might not have an ID by default, so query by class or tag if needed for hiding
  document.body.appendChild(arButton);


  document.getElementById("place-object-btn").addEventListener("click", onSelect);

  document.getElementById("delete-object-btn").addEventListener("click", () => {
    if (lastPlacedObject) {
      scene.remove(lastPlacedObject);
      lastPlacedObject.traverse(child => {
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
      currentScale = DEFAULT_OBJECT_SCALE;
    }
  });

  document.getElementById("object1").addEventListener("click", (event) => {
    event.stopPropagation(); selectedObject = "obj1";
  });
  document.getElementById("object2").addEventListener("click", (event) => {
    event.stopPropagation(); selectedObject = "obj2";
  });
  document.getElementById("object3").addEventListener("click", (event) => {
    event.stopPropagation(); selectedObject = "obj3";
  });
  document.getElementById("object4").addEventListener("click", (event) => {
    event.stopPropagation(); selectedObject = "obj4";
  });
  document.getElementById("object5").addEventListener("click", (event) => {
    event.stopPropagation(); selectedObject = "obj5";
  });

  function onSelect() {
    if (reticle.visible) {
      let modelToClone;
      if (selectedObject === "obj1" && object1) modelToClone = object1;
      else if (selectedObject === "obj2" && object2) modelToClone = object2;
      else if (selectedObject === "obj3" && object3) modelToClone = object3;
      else if (selectedObject === "obj4" && object4) modelToClone = object4;
      else if (selectedObject === "obj5" && object5) modelToClone = object5;

      if (modelToClone) {
        if (lastPlacedObject) { // Remove previous object if one exists
             scene.remove(lastPlacedObject);
             // Consider full disposal here if placing many unique objects over time
        }

        const mesh = modelToClone.clone();
        document.getElementById("delete-object-btn").style.display = "flex";

        const newPosition = new THREE.Vector3();
        const newQuaternion = new THREE.Quaternion();
        const tempScale = new THREE.Vector3();

        reticle.matrix.decompose(newPosition, newQuaternion, tempScale);
        mesh.position.copy(newPosition);
        mesh.quaternion.copy(newQuaternion);
        mesh.scale.set(currentScale, currentScale, currentScale);

        const cameraLookAt = new THREE.Vector3();
        camera.getWorldPosition(cameraLookAt); // Get camera's world position
        mesh.lookAt(cameraLookAt.x, mesh.position.y, cameraLookAt.z); // Look at camera on the XZ plane

        scene.add(mesh);
        lastPlacedObject = mesh;

        const targetScaleVal = currentScale;
        const startAnimScaleFactor = 0.1;
        mesh.scale.set(
          targetScaleVal * startAnimScaleFactor,
          targetScaleVal * startAnimScaleFactor,
          targetScaleVal * startAnimScaleFactor
        );

        const animationDuration = 300;
        const startTime = performance.now();
        function animateEntry() {
          if (!mesh.parent) return;
          const elapsedTime = performance.now() - startTime;
          if (elapsedTime >= animationDuration) {
            mesh.scale.set(targetScaleVal, targetScaleVal, targetScaleVal);
            return;
          }
          const progress = elapsedTime / animationDuration;
          const easedProgress = 1 - Math.pow(1 - progress, 3);
          const newAnimScale = targetScaleVal * startAnimScaleFactor + targetScaleVal * (1 - startAnimScaleFactor) * easedProgress;
          mesh.scale.set(newAnimScale, newAnimScale, newAnimScale);
          requestAnimationFrame(animateEntry);
        }
        requestAnimationFrame(animateEntry);
      }
    }
  }

  controller = renderer.xr.getController(0);
  scene.add(controller);

  reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.075, 0.1, 24, 1, 0, Math.PI * 2).rotateX(-Math.PI / 2), // Increased segments for smoother ring
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, side: THREE.DoubleSide })
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  const gltfLoader = new GLTFLoader();
  const textureLoader = new THREE.TextureLoader();
  const loadErrorCallback = (name) => (error) => console.error(`Error loading ${name}:`, error);

  gltfLoader.load("Shelf.glb", (gltf) => { object1 = gltf.scene; }, undefined, loadErrorCallback("Shelf.glb"));

  const shelfTexture = textureLoader.load("Shelf.png", undefined, undefined, loadErrorCallback("Shelf.png"));
  shelfTexture.flipY = false;
  gltfLoader.load("Shelf2.glb", (gltf) => {
    object2 = gltf.scene;
    object2.traverse(node => {
      if (node.isMesh) {
        const newMaterial = node.material.clone();
        newMaterial.map = shelfTexture;
        newMaterial.needsUpdate = true;
        node.material = newMaterial;
      }
    });
  }, undefined, loadErrorCallback("Shelf2.glb"));

  const bagTexture = textureLoader.load("Map1.png", undefined, undefined, loadErrorCallback("Map1.png"));
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
  }, undefined, loadErrorCallback("Bag1.glb"));

  const bagTexture2 = textureLoader.load("Map2.jpg", undefined, undefined, loadErrorCallback("Map2.jpg"));
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
  }, undefined, loadErrorCallback("Bag2.glb"));

  const bagTexture3 = textureLoader.load("Map3.png", undefined, undefined, loadErrorCallback("Map3.png"));
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
  }, undefined, loadErrorCallback("Bag3.glb"));

  window.addEventListener("resize", onWindowResize);
  window.addEventListener("touchstart", onTouchStart, { passive: false });
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

    if (hitTestSourceRequested === false && session) {
      session.requestReferenceSpace("viewer").then((refSpace) => {
        session.requestHitTestSource({ space: refSpace })
          .then((source) => { hitTestSource = source; })
          .catch(err => console.error("Error requesting hit test source:", err));
      }).catch(err => console.error("Error requesting viewer reference space:", err));

      session.addEventListener("end", () => {
        hitTestSourceRequested = false;
        hitTestSource = null;
        planeFound = false;
        document.getElementById("tracking-prompt").style.display = "none";
        document.getElementById("instructions").style.display = "none";
        document.getElementById("button-container").style.display = "none";
        if(lastPlacedObject) {
            scene.remove(lastPlacedObject);
            lastPlacedObject = null; // No need to dispose here if re-placing the same few models
        }
        currentScale = DEFAULT_OBJECT_SCALE; // Reset scale on session end
      });
      hitTestSourceRequested = true;
    }

    if (hitTestSource && referenceSpace) { // Ensure referenceSpace is available
      const hitTestResults = frame.getHitTestResults(hitTestSource);
      if (hitTestResults.length) {
        if (!planeFound) {
          planeFound = true;
          document.getElementById("tracking-prompt").style.display = "none";
          document.getElementById("instructions").style.display = "flex";
          document.getElementById("button-container").style.display = "flex";
        }
        const hit = hitTestResults[0];
        if (hit && hit.getPose) {
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
  // No preventDefault here, let LaunchAR SDK handle its overlay touches.
  // We only care about touches that might be on our 3D content,
  // which ARButton and hit-testing help segregate.

  if (event.touches.length === 3 && lastPlacedObject) {
    threeFingerMoving = true;
    initialZPosition = lastPlacedObject.position.y;
    initialThreeFingerY = event.touches[0].pageY;
    pinchScaling = pinchRotating = moving = false;
  } else if (event.touches.length === 2 && lastPlacedObject) {
    pinchScaling = true;
    pinchRotating = true;
    initialPinchDistance = getPinchDistance(event.touches);
    initialPinchAngle = getPinchAngle(event.touches);
    currentScale = lastPlacedObject.scale.x; // Capture scale at start of pinch
    moving = threeFingerMoving = false;
  } else if (event.touches.length === 1 && lastPlacedObject) {
    // Check if the touch is over a UI element with data-ignore-tap
    let targetElement = event.target;
    let ignoreTap = false;
    while(targetElement && targetElement !== document.body) {
        if (targetElement.dataset && targetElement.dataset.ignoreTap === 'true') {
            ignoreTap = true;
            break;
        }
        targetElement = targetElement.parentElement;
    }

    if (!ignoreTap) { // Only start moving if not on an ignored UI element
        moving = true;
        initialTouchPosition = new THREE.Vector2(event.touches[0].pageX, event.touches[0].pageY);
        pinchScaling = pinchRotating = threeFingerMoving = false;
    }
  }
}

function onTouchMove(event) {
  if (threeFingerMoving && event.touches.length === 3 && lastPlacedObject) {
    const deltaY = initialThreeFingerY - event.touches[0].pageY;
    const moveAmount = deltaY * 0.005;
    lastPlacedObject.position.y = initialZPosition + moveAmount;
  } else if (pinchScaling && event.touches.length === 2 && lastPlacedObject) {
    const newPinchDistance = getPinchDistance(event.touches);
    const scaleChange = newPinchDistance / initialPinchDistance;
    const newObjectScale = currentScale * scaleChange;
    lastPlacedObject.scale.set(newObjectScale, newObjectScale, newObjectScale);

    if (pinchRotating) { // Keep rotation within the same block for simplicity
      const newPinchAngle = getPinchAngle(event.touches);
      const angleChange = newPinchAngle - initialPinchAngle;
      lastPlacedObject.rotation.y += angleChange;
      initialPinchAngle = newPinchAngle;
    }
  } else if (moving && event.touches.length === 1 && lastPlacedObject) {
    const currentTouchPosition = new THREE.Vector2(event.touches[0].pageX, event.touches[0].pageY);
    const dxScreen = currentTouchPosition.x - initialTouchPosition.x;
    const dyScreen = currentTouchPosition.y - initialTouchPosition.y;

    const moveXAmount = dxScreen * MOVE_SENSITIVITY;
    const moveZAmount = dyScreen * MOVE_SENSITIVITY; // Screen Y drag moves object along camera's projected Z

    // Get camera's orientation
    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    cameraDirection.y = 0; // Project onto XZ plane
    cameraDirection.normalize();

    const cameraRight = new THREE.Vector3();
    // camera.up is (0,1,0) by default. Cross with XZ-projected forward to get XZ-projected right.
    cameraRight.crossVectors(new THREE.Vector3(0, 1, 0), cameraDirection).normalize().negate();
    // Negate because cross(Y, Z_cam_proj) gives -X_cam_proj if Z_cam_proj is along world +Z or +X

    const worldMove = new THREE.Vector3();
    worldMove.addScaledVector(cameraRight, moveXAmount);    // Move along camera's X-axis
    worldMove.addScaledVector(cameraDirection, moveZAmount); // Move along camera's Z-axis (projected)

    lastPlacedObject.position.x += worldMove.x;
    lastPlacedObject.position.z += worldMove.z;

    initialTouchPosition.copy(currentTouchPosition);
  }
}

function onTouchEnd(event) {
  if (threeFingerMoving && event.touches.length < 3) {
    threeFingerMoving = false;
  }
  if ((pinchScaling || pinchRotating) && event.touches.length < 2) {
    if (lastPlacedObject) {
      currentScale = lastPlacedObject.scale.x; // Update currentScale to object's final scale
    }
    pinchScaling = false;
    pinchRotating = false;
  }
  if (moving && event.touches.length < 1) {
    moving = false;
  }

  // If all touches are up, reset all gesture flags just in case
  if (event.touches.length === 0) {
    threeFingerMoving = false;
    pinchScaling = false;
    pinchRotating = false;
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