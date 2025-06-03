import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ARButton } from "three/examples/jsm/webxr/ARButton.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import "./qr.js";
import "./style.css";

// --- Global Variables ---
let container;
let camera, scene, renderer;
let controller;
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
let currentSelectedIndex = -1; // Index of the selected object in allPlacedObjects
let originalMaterials = new Map();

const SELECTION_COLOR = 0xFFF176;
const MOVE_SENSITIVITY = 0.002;
const HDR_ENVIRONMENT_MAP_PATH = "hdr.hdr";

let initialPinchDistance = null,
  pinchScaling = false;
let initialPinchAngle = null,
  pinchRotating = false;
let moving = false,
  initialTouchPosition = null;
let threeFingerMoving = false,
  initialZPosition = null,
  initialThreeFingerY = null;

// const raycaster = new THREE.Raycaster(); // Raycaster no longer needed for selection
// const tapPosition = new THREE.Vector2(); // Tap position no longer needed for selection

let selectedObject = "obj1"; // For the object palette

// UI Elements
let placeObjectBtn, deleteObjectBtn, prevObjectBtn, nextObjectBtn;

// --- UI Helper ---
function updateSelectedObjectButton(selectedId) {
  document.querySelectorAll(".object-btn").forEach((btn) => {
    btn.classList.remove("selected");
    if (btn.dataset.objectId === selectedId) {
      btn.classList.add("selected");
    }
  });
}

function updateCycleButtonVisibility() {
  const show = allPlacedObjects.length > 1;
  if (prevObjectBtn) prevObjectBtn.style.display = show ? "flex" : "none";
  if (nextObjectBtn) nextObjectBtn.style.display = show ? "flex" : "none";
}

// --- WebXR Support & Session ---
if ("xr" in navigator) {
  navigator.xr
    .isSessionSupported("immersive-ar")
    .then((supported) => {
      if (supported) {
        document.getElementById("ar-not-supported").style.display = "none";
        init();
        animate();
      } else {
        document.getElementById("ar-not-supported").innerHTML =
          "Immersive AR not supported.";
      }
    })
    .catch((err) => {
      console.error("AR support error:", err);
      document.getElementById("ar-not-supported").innerHTML =
        "AR support error.";
    });
} else {
  document.getElementById("ar-not-supported").innerHTML =
    "WebXR API not found.";
}

function sessionStart() {
  planeFound = false;
  document.getElementById("tracking-prompt").style.display = "flex";
  document.getElementById("bottom-controls").style.display = "none";
  if (selectedForManipulationObject)
    deselectObject(selectedForManipulationObject);
  if (deleteObjectBtn) deleteObjectBtn.style.display = "none";
  currentSelectedIndex = -1;
  updateCycleButtonVisibility();
}

// --- Material Management for Selection ---
function storeOriginalMaterials(object) {
  if (originalMaterials.has(object)) return;
  const materialsToStore = [];
  object.traverse((child) => {
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
    materialsInfo.forEach((info) => {
      if (
        info.mesh.material !== info.material &&
        !info.mesh.material.userData?.isOriginal
      ) {
        info.mesh.material.dispose();
      }
      info.mesh.material = info.material;
    });
  }
}

function highlightSelectedObject(object) {
  storeOriginalMaterials(object);
  object.traverse((child) => {
    if (child.isMesh && child.material) {
      const originalChildMaterial = originalMaterials
        .get(object)
        ?.find((m) => m.mesh === child)?.material;
      if (
        child.material !== originalChildMaterial &&
        !child.material.userData?.isOriginal
      ) {
        child.material.dispose();
      }
      const highlightMaterial = new THREE.MeshStandardMaterial({
        color: SELECTION_COLOR,
        emissive: SELECTION_COLOR,
        emissiveIntensity: 0.1,
        map: originalChildMaterial?.map || null,
      });
      child.material = highlightMaterial;
    }
  });
}

function selectObject(object) {
  if (!object) return;
  if (selectedForManipulationObject === object) return;

  if (selectedForManipulationObject) {
    restoreOriginalMaterials(selectedForManipulationObject);
  }

  selectedForManipulationObject = object;
  highlightSelectedObject(object);
  if (deleteObjectBtn) deleteObjectBtn.style.display = "flex";
  currentScale = selectedForManipulationObject.scale.x;

  currentSelectedIndex = allPlacedObjects.indexOf(object);
  updateCycleButtonVisibility();
}

function deselectObject(objectToDeselect) {
  if (!objectToDeselect || selectedForManipulationObject !== objectToDeselect)
    return;

  restoreOriginalMaterials(objectToDeselect);
  selectedForManipulationObject = null;
  if (deleteObjectBtn) deleteObjectBtn.style.display = "none";
  currentSelectedIndex = -1;
  // updateCycleButtonVisibility(); // Called by functions that change allPlacedObjects or selection
}

// --- Initialization ---
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

  const hemiLight = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 0.6);
  scene.add(hemiLight);
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambientLight);
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(1.5, 2, 1).normalize();
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 1024;
  directionalLight.shadow.mapSize.height = 1024;
  // ... (shadow camera setup)
  directionalLight.shadow.bias = -0.001;
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

  new RGBELoader().setPath("").load(
    HDR_ENVIRONMENT_MAP_PATH,
    (texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      scene.environment = texture;
      console.log(`Env map '${HDR_ENVIRONMENT_MAP_PATH}' loaded.`);
    },
    undefined,
    (err) =>
      console.error(`HDR Load Error for '${HDR_ENVIRONMENT_MAP_PATH}':`, err)
  );

  const arButton = ARButton.createButton(renderer, {
    requiredFeatures: ["local", "hit-test", "dom-overlay"],
    domOverlay: { root: document.querySelector("#overlay") },
  });
  document.body.appendChild(arButton);

  // Get UI elements
  placeObjectBtn = document.getElementById("place-object-btn");
  deleteObjectBtn = document.getElementById("delete-object-btn");
  prevObjectBtn = document.getElementById("prev-object-btn");
  nextObjectBtn = document.getElementById("next-object-btn");

  placeObjectBtn.addEventListener("click", onSelect);

  deleteObjectBtn.addEventListener("click", () => {
    if (selectedForManipulationObject) {
      const deletedObject = selectedForManipulationObject;
      const deletedObjectIndex = allPlacedObjects.indexOf(deletedObject);

      scene.remove(deletedObject);
      allPlacedObjects = allPlacedObjects.filter(
        (obj) => obj !== deletedObject
      );
      originalMaterials.delete(deletedObject);
      deletedObject.traverse((child) => {
        if (child.isMesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach((mat) => {
                if (mat.map) mat.map.dispose();
                mat.dispose();
              });
            } else {
              if (child.material.map) child.material.map.dispose();
              child.material.dispose();
            }
          }
        }
      });

      selectedForManipulationObject = null;
      currentSelectedIndex = -1;
      deleteObjectBtn.style.display = "none";

      if (allPlacedObjects.length > 0) {
        let newIndexToSelect = deletedObjectIndex;
        if (newIndexToSelect >= allPlacedObjects.length) {
          newIndexToSelect = allPlacedObjects.length - 1;
        }
        if (newIndexToSelect < 0) newIndexToSelect = 0;

        if (allPlacedObjects[newIndexToSelect]) {
          selectObject(allPlacedObjects[newIndexToSelect]);
        }
      }
      updateCycleButtonVisibility();
    }
  });

  prevObjectBtn.addEventListener("click", () => {
    if (allPlacedObjects.length === 0) return;
    if (currentSelectedIndex === -1 && allPlacedObjects.length > 0) {
      currentSelectedIndex = allPlacedObjects.length - 1; // Select last
    } else {
      currentSelectedIndex--;
      if (currentSelectedIndex < 0) {
        currentSelectedIndex = allPlacedObjects.length - 1;
      }
    }
    selectObject(allPlacedObjects[currentSelectedIndex]);
  });

  nextObjectBtn.addEventListener("click", () => {
    if (allPlacedObjects.length === 0) return;
    if (currentSelectedIndex === -1 && allPlacedObjects.length > 0) {
      currentSelectedIndex = 0; // Select first
    } else {
      currentSelectedIndex++;
      if (currentSelectedIndex >= allPlacedObjects.length) {
        currentSelectedIndex = 0;
      }
    }
    selectObject(allPlacedObjects[currentSelectedIndex]);
  });

  document.querySelectorAll(".object-btn").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      selectedObject = button.dataset.objectId;
      updateSelectedObjectButton(selectedObject);
    });
  });
  const firstObjBtn = document.querySelector(".object-btn");
  if (firstObjBtn) {
    selectedObject = firstObjBtn.dataset.objectId;
    updateSelectedObjectButton(selectedObject);
  }

  reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.075, 0.1, 24).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    })
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  const gltfLoader = new GLTFLoader();
  const textureLoader = new THREE.TextureLoader();
  const loadErrCb = (name) => (e) => console.error(`Err load ${name}`, e);
  function applyTex(gltfScn, tex) {
    gltfScn.traverse((n) => {
      if (n.isMesh) {
        let m;
        if (n.material?.isMeshStandardMaterial) m = n.material.clone();
        else {
          m = new THREE.MeshStandardMaterial();
          if (n.material?.color) m.color.copy(n.material.color);
        }
        m.map = tex;
        m.needsUpdate = true;
        n.material = m;
      }
    });
  }

  gltfLoader.load(
    "Shelf.glb",
    (g) => {
      object1 = g.scene;
      if (object1) object1.name = "Shelf_GLTF_Root";
    },
    undefined,
    loadErrCb("Shelf.glb")
  );
  textureLoader.load(
    "Shelf.png",
    (t) => {
      t.flipY = false;
      t.encoding = THREE.sRGBEncoding;
      gltfLoader.load(
        "Shelf2.glb",
        (g) => {
          object2 = g.scene;
          if (object2) {
            object2.name = "Shelf2_GLTF_Root";
            applyTex(object2, t);
          }
        },
        undefined,
        loadErrCb("Shelf2.glb")
      );
    },
    undefined,
    loadErrCb("Shelf.png")
  );
  textureLoader.load(
    "Map1.png",
    (t) => {
      t.flipY = false;
      t.encoding = THREE.sRGBEncoding;
      gltfLoader.load(
        "Bag1.glb",
        (g) => {
          object3 = g.scene;
          if (object3) {
            object3.name = "Bag1_GLTF_Root";
            applyTex(object3, t);
          }
        },
        undefined,
        loadErrCb("Bag1.glb")
      );
    },
    undefined,
    loadErrCb("Map1.png")
  );
  textureLoader.load(
    "Map2.jpg",
    (t) => {
      t.flipY = false;
      t.encoding = THREE.sRGBEncoding;
      gltfLoader.load(
        "Bag2.glb",
        (g) => {
          object4 = g.scene;
          if (object4) {
            object4.name = "Bag2_GLTF_Root";
            applyTex(object4, t);
          }
        },
        undefined,
        loadErrCb("Bag2.glb")
      );
    },
    undefined,
    loadErrCb("Map2.jpg")
  );
  textureLoader.load(
    "Map3.png",
    (t) => {
      t.flipY = false;
      t.encoding = THREE.sRGBEncoding;
      gltfLoader.load(
        "Bag3.glb",
        (g) => {
          object5 = g.scene;
          if (object5) {
            object5.name = "Bag3_GLTF_Root";
            applyTex(object5, t);
          }
        },
        undefined,
        loadErrCb("Bag3.glb")
      );
    },
    undefined,
    loadErrCb("Map3.png")
  );

  window.addEventListener("resize", onWindowResize);
  window.addEventListener("touchstart", onTouchStart, { passive: false });
  window.addEventListener("touchmove", onTouchMove, { passive: false });
  window.addEventListener("touchend", onTouchEnd, false);
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
      mesh.name =
        (modelToClone.name || "ClonedObject") + "_instance_" + Date.now();
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      const newPosition = new THREE.Vector3();
      const newQuaternion = new THREE.Quaternion();
      reticle.matrix.decompose(newPosition, newQuaternion, new THREE.Vector3());
      mesh.position.copy(newPosition);
      mesh.quaternion.copy(newQuaternion);
      mesh.scale.set(currentScale, currentScale, currentScale);

      const camLookAt = new THREE.Vector3();
      camera.getWorldPosition(camLookAt);
      mesh.lookAt(camLookAt.x, mesh.position.y, camLookAt.z);

      scene.add(mesh);
      lastPlacedObject = mesh;
      allPlacedObjects.push(mesh);

      selectObject(mesh); // Select the newly placed object
      // updateCycleButtonVisibility(); // selectObject calls this

      const targetScaleVal = mesh.scale.x;
      mesh.scale.setScalar(targetScaleVal * 0.1);
      const animStartTime = performance.now();
      function animateEntry() {
        if (!mesh.parent) return;
        const elapsed = performance.now() - animStartTime;
        if (elapsed >= 300) {
          mesh.scale.setScalar(targetScaleVal);
          return;
        }
        const progress = 1 - Math.pow(1 - elapsed / 300, 3);
        mesh.scale.setScalar(
          targetScaleVal * 0.1 + targetScaleVal * 0.9 * progress
        );
        requestAnimationFrame(animateEntry);
      }
      requestAnimationFrame(animateEntry);
    }
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
    if (hitTestSourceRequested === false && session) {
      session
        .requestReferenceSpace("viewer")
        .then((viewerRefSpace) => {
          session
            .requestHitTestSource({ space: viewerRefSpace })
            .then((source) => {
              hitTestSource = source;
            })
            .catch((err) => console.error("Hit test source error:", err));
        })
        .catch((err) => console.error("Viewer ref space error:", err));
      session.addEventListener("end", () => {
        hitTestSourceRequested = false;
        hitTestSource = null;
        planeFound = false;
        document.getElementById("tracking-prompt").style.display = "none";
        document.getElementById("bottom-controls").style.display = "none";
        if (selectedForManipulationObject)
          deselectObject(selectedForManipulationObject);
        allPlacedObjects.forEach((obj) => scene.remove(obj));
        allPlacedObjects = [];
        originalMaterials.clear();
        lastPlacedObject = null;
        currentScale = DEFAULT_OBJECT_SCALE;
        currentSelectedIndex = -1;
        updateCycleButtonVisibility();
      });
      hitTestSourceRequested = true;
    }
    if (hitTestSource && referenceSpace) {
      const hitTestResults = frame.getHitTestResults(hitTestSource);
      if (hitTestResults.length) {
        if (!planeFound) {
          planeFound = true;
          document.getElementById("tracking-prompt").style.display = "none";
          document.getElementById("bottom-controls").style.display = "flex";
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
  let targetElement = event.target;
  let uiTap = false;
  let currentElement = targetElement;
  while (currentElement && currentElement !== document.body) {
    if (
      currentElement.dataset?.ignoreTap === "true" ||
      currentElement.id === "object-selector" ||
      currentElement.id === "action-buttons" ||
      currentElement.closest(".object-btn") ||
      currentElement.closest(".action-btn")
    ) {
      uiTap = true;
      break;
    }
    currentElement = currentElement.parentElement;
  }

  if (uiTap) {
    moving = pinchScaling = pinchRotating = threeFingerMoving = false;
    return;
  }

  // If no object is selected, touch interactions on the scene (other than UI) do nothing.
  if (!selectedForManipulationObject) {
    moving = pinchScaling = pinchRotating = threeFingerMoving = false;
    return;
  }

  // At this point, an object IS selected, and the touch is NOT on a UI element.
  // Handle gestures for the selectedForManipulationObject
  if (event.touches.length === 1) {
    moving = true;
    initialTouchPosition = new THREE.Vector2(
      event.touches[0].pageX,
      event.touches[0].pageY
    );
    pinchScaling = pinchRotating = threeFingerMoving = false;
  } else if (event.touches.length === 2) {
    pinchScaling = true;
    pinchRotating = true;
    initialPinchDistance = getPinchDistance(event.touches);
    initialPinchAngle = getPinchAngle(event.touches);
    moving = threeFingerMoving = false;
  } else if (event.touches.length === 3) {
    threeFingerMoving = true;
    initialZPosition = selectedForManipulationObject.position.y;
    initialThreeFingerY = event.touches[0].pageY;
    pinchScaling = pinchRotating = moving = false;
  }
}

function onTouchMove(event) {
  if (
    !selectedForManipulationObject &&
    !moving &&
    !pinchScaling &&
    !threeFingerMoving
  )
    return;

  if (
    threeFingerMoving &&
    event.touches.length === 3 &&
    selectedForManipulationObject
  ) {
    const deltaY = initialThreeFingerY - event.touches[0].pageY;
    selectedForManipulationObject.position.y =
      initialZPosition + deltaY * 0.005;
  } else if (
    pinchScaling &&
    event.touches.length === 2 &&
    selectedForManipulationObject
  ) {
    const newPinchDistance = getPinchDistance(event.touches);
    if (initialPinchDistance === null || initialPinchDistance === 0) {
      initialPinchDistance = newPinchDistance;
      return;
    }
    const scaleChange = newPinchDistance / initialPinchDistance;
    const newObjectScale = currentScale * scaleChange;
    selectedForManipulationObject.scale.set(
      newObjectScale,
      newObjectScale,
      newObjectScale
    );

    if (pinchRotating) {
      const newPinchAngle = getPinchAngle(event.touches);
      if (initialPinchAngle === null) {
        initialPinchAngle = newPinchAngle;
        return;
      }
      selectedForManipulationObject.rotation.y +=
        newPinchAngle - initialPinchAngle;
      initialPinchAngle = newPinchAngle;
    }
  } else if (
    moving &&
    event.touches.length === 1 &&
    selectedForManipulationObject
  ) {
    if (initialTouchPosition === null) {
      initialTouchPosition = new THREE.Vector2(
        event.touches[0].pageX,
        event.touches[0].pageY
      );
      return;
    }
    const currentTouch = new THREE.Vector2(
      event.touches[0].pageX,
      event.touches[0].pageY
    );
    const dxScreen = currentTouch.x - initialTouchPosition.x;
    const dyScreen = currentTouch.y - initialTouchPosition.y;

    const cameraRight = new THREE.Vector3().setFromMatrixColumn(
      camera.matrixWorld,
      0
    );
    cameraRight.y = 0;
    cameraRight.normalize();

    const cameraForward = new THREE.Vector3().setFromMatrixColumn(
      camera.matrixWorld,
      2
    );
    cameraForward.negate();
    cameraForward.y = 0;
    cameraForward.normalize();

    const worldMoveX = cameraRight
      .clone()
      .multiplyScalar(dxScreen * MOVE_SENSITIVITY);
    const worldMoveZ = cameraForward
      .clone()
      .multiplyScalar(-dyScreen * MOVE_SENSITIVITY);

    selectedForManipulationObject.position.add(worldMoveX);
    selectedForManipulationObject.position.add(worldMoveZ);
    initialTouchPosition.copy(currentTouch);
  }
}

function onTouchEnd(event) {
  if (threeFingerMoving && event.touches.length < 3) {
    threeFingerMoving = false;
    initialZPosition = null;
    initialThreeFingerY = null;
  }
  if ((pinchScaling || pinchRotating) && event.touches.length < 2) {
    if (selectedForManipulationObject) {
      currentScale = selectedForManipulationObject.scale.x;
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
  if (event.touches.length === 0) {
    threeFingerMoving = pinchScaling = pinchRotating = moving = false;
    initialPinchDistance = null;
    initialPinchAngle = null;
    initialTouchPosition = null;
    initialZPosition = null;
    initialThreeFingerY = null;
  }
}

function getPinchDistance(touches) {
  return Math.hypot(
    touches[0].pageX - touches[1].pageX,
    touches[0].pageY - touches[1].pageY
  );
}
function getPinchAngle(touches) {
  return Math.atan2(
    touches[0].pageY - touches[1].pageY,
    touches[0].pageX - touches[1].pageX
  );
}
