import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ARButton } from "three/examples/jsm/webxr/ARButton.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import "./qr.js";
import "./style.css";

let container;
let camera, scene, renderer;
let reticle;

let object1, object2, object3, object4, object5; // Loaded GLTF model sources

let hitTestSource = null;
let hitTestSourceRequested = false;
let planeFound = false;

const DEFAULT_OBJECT_SCALE = 0.2;
let currentGlobalScale = DEFAULT_OBJECT_SCALE; // Scale for NEWLY placed objects
let selectedForManipulation = null; // The currently selected object for interaction
let allPlacedObjects = []; // Array to store all placed object instances

const raycaster = new THREE.Raycaster();
const tapPosition = new THREE.Vector2();
const originalMaterials = new Map(); // To store original material properties for highlight restoration

let selectedObjectUI = "obj1"; // ID of the object type selected in the UI palette

// Touch gesture state variables
let initialPinchDistance = null,
  pinchScaling = false,
  scaleAtPinchStart = 1.0;
let initialPinchAngle = null,
  pinchRotating = false;
let moving = false,
  initialTouchPosition = null;
const MOVE_SENSITIVITY = 0.002;
let threeFingerMoving = false,
  initialZObjectPosition = null,
  initialZTouchY = null;

const HDR_ENVIRONMENT_MAP_PATH = "hdr.hdr"; // REPLACE!

function updateSelectedObjectUIButton(selectedId) {
  document.querySelectorAll(".object-btn").forEach((btn) => {
    btn.classList.remove("selected");
    if (btn.dataset.objectId === selectedId) btn.classList.add("selected");
  });
}

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
      console.error("AR support err:", err);
      document.getElementById("ar-not-supported").innerHTML = "AR check error.";
    });
} else {
  document.getElementById("ar-not-supported").innerHTML =
    "WebXR API not found.";
}

function sessionStart() {
  planeFound = false;
  document.getElementById("tracking-prompt").style.display = "flex";
  document.getElementById("bottom-controls").style.display = "none";
  deselectObject(); // Also hides delete button
  allPlacedObjects.forEach((obj) => scene.remove(obj)); // Clean up scene
  allPlacedObjects = []; // Reset tracked objects
  originalMaterials.clear(); // Clear stored original materials
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

  const hemiLight = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 0.6);
  scene.add(hemiLight);
  const ambLight = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambLight);
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(1.5, 2, 1).normalize();
  dirLight.castShadow = true;
  Object.assign(dirLight.shadow, {
    mapSize: new THREE.Vector2(1024, 1024),
    camera: Object.assign(dirLight.shadow.camera, {
      near: 0.1,
      far: 10,
      left: -2,
      right: 2,
      top: 2,
      bottom: -2,
    }),
    bias: -0.001,
  });
  scene.add(dirLight);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  Object.assign(renderer, {
    outputEncoding: THREE.sRGBEncoding,
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 1.0,
  });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  renderer.xr.addEventListener("sessionstart", sessionStart);

  new RGBELoader().load(
    HDR_ENVIRONMENT_MAP_PATH,
    (t) => {
      t.mapping = THREE.EquirectangularReflectionMapping;
      scene.environment = t;
      console.log("Env map loaded.");
    },
    undefined,
    (e) => console.error("HDR Err:", e)
  );
  const arBtn = ARButton.createButton(renderer, {
    requiredFeatures: ["local", "hit-test", "dom-overlay"],
    domOverlay: { root: document.querySelector("#overlay") },
  });
  document.body.appendChild(arBtn);

  document
    .getElementById("place-object-btn")
    .addEventListener("click", placeNewObject);
  document.getElementById("delete-object-btn").addEventListener("click", () => {
    if (selectedForManipulation) {
      scene.remove(selectedForManipulation);
      selectedForManipulation.traverse((c) => {
        if (c.isMesh) {
          if (c.geometry) c.geometry.dispose();
          if (c.material) {
            if (Array.isArray(c.material))
              c.material.forEach((m) => {
                if (m.map) m.map.dispose();
                m.dispose();
              });
            else {
              if (c.material.map) c.material.map.dispose();
              c.material.dispose();
            }
          }
        }
      });
      allPlacedObjects = allPlacedObjects.filter(
        (o) => o !== selectedForManipulation
      );
      deselectObject();
    }
  });
  document.querySelectorAll(".object-btn").forEach((b) => {
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      selectedObjectUI = b.dataset.objectId;
      updateSelectedObjectUIButton(selectedObjectUI);
    });
  });
  const fob = document.querySelector(".object-btn");
  if (fob) {
    selectedObjectUI = fob.dataset.objectId;
    updateSelectedObjectUIButton(selectedObjectUI);
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
  const texLoader = new THREE.TextureLoader();
  const LE = (n) => (e) => console.error(`Err ${n}:`, e);
  const AT = (s, t) => {
    s.traverse((n) => {
      if (n.isMesh && n.material) {
        const mats = Array.isArray(n.material) ? n.material : [n.material];
        n.material = mats.map((origMat) => {
          let newMat;
          if (origMat.isMeshStandardMaterial) newMat = origMat.clone();
          else {
            newMat = new THREE.MeshStandardMaterial();
            if (origMat.color) newMat.color.copy(origMat.color);
          }
          newMat.map = t;
          newMat.needsUpdate = true;
          return newMat;
        });
        if (!Array.isArray(n.material) && n.material.length === 1)
          n.material = n.material[0];
      }
    });
  }; // Apply texture with material cloning
  gltfLoader.load(
    "Shelf.glb",
    (g) => {
      object1 = g.scene;
    },
    undefined,
    LE("Shelf.glb")
  );
  texLoader.load(
    "Shelf.png",
    (t) => {
      t.flipY = false;
      t.encoding = THREE.sRGBEncoding;
      gltfLoader.load(
        "Shelf2.glb",
        (g) => {
          object2 = g.scene;
          AT(object2, t);
        },
        undefined,
        LE("Shelf2.glb")
      );
    },
    undefined,
    LE("Shelf.png")
  );
  texLoader.load(
    "Map1.png",
    (t) => {
      t.flipY = false;
      t.encoding = THREE.sRGBEncoding;
      gltfLoader.load(
        "Bag1.glb",
        (g) => {
          object3 = g.scene;
          AT(object3, t);
        },
        undefined,
        LE("Bag1.glb")
      );
    },
    undefined,
    LE("Map1.png")
  );
  texLoader.load(
    "Map2.jpg",
    (t) => {
      t.flipY = false;
      t.encoding = THREE.sRGBEncoding;
      gltfLoader.load(
        "Bag2.glb",
        (g) => {
          object4 = g.scene;
          AT(object4, t);
        },
        undefined,
        LE("Bag2.glb")
      );
    },
    undefined,
    LE("Map2.jpg")
  );
  texLoader.load(
    "Map3.png",
    (t) => {
      t.flipY = false;
      t.encoding = THREE.sRGBEncoding;
      gltfLoader.load(
        "Bag3.glb",
        (g) => {
          object5 = g.scene;
          AT(object5, t);
        },
        undefined,
        LE("Bag3.glb")
      );
    },
    undefined,
    LE("Map3.png")
  );

  window.addEventListener("resize", onWindowResize);
  window.addEventListener("touchstart", onTouchStart, { passive: false });
  window.addEventListener("touchmove", onTouchMove, { passive: false });
  window.addEventListener("touchend", onTouchEnd, false);
}

function placeNewObject() {
  if (!reticle.visible) return;
  let modelSource;
  if (selectedObjectUI === "obj1" && object1) modelSource = object1;
  else if (selectedObjectUI === "obj2" && object2) modelSource = object2;
  else if (selectedObjectUI === "obj3" && object3) modelSource = object3;
  else if (selectedObjectUI === "obj4" && object4) modelSource = object4;
  else if (selectedObjectUI === "obj5" && object5) modelSource = object5;

  if (modelSource) {
    const newInstance = modelSource.clone();
    newInstance.traverse((c) => {
      if (c.isMesh && c.material) {
        if (Array.isArray(c.material))
          c.material = c.material.map((m) => m.clone());
        else c.material = c.material.clone();
      }
      c.castShadow = true;
      c.receiveShadow = true;
    });
    const p = new THREE.Vector3(),
      q = new THREE.Quaternion();
    reticle.matrix.decompose(p, q, new THREE.Vector3());
    newInstance.position.copy(p);
    newInstance.quaternion.copy(q);
    newInstance.scale.setScalar(currentGlobalScale);
    const cL = new THREE.Vector3();
    camera.getWorldPosition(cL);
    newInstance.lookAt(cL.x, newInstance.position.y, cL.z);
    scene.add(newInstance);
    allPlacedObjects.push(newInstance);
    selectObject(newInstance);
    const tS = newInstance.scale.x;
    newInstance.scale.setScalar(tS * 0.1);
    const t0 = performance.now();
    function a() {
      if (!newInstance.parent) return;
      const e = performance.now() - t0;
      if (e >= 300) {
        newInstance.scale.setScalar(tS);
        return;
      }
      const pr = 1 - Math.pow(1 - e / 300, 3);
      newInstance.scale.setScalar(tS * 0.1 + tS * 0.9 * pr);
      requestAnimationFrame(a);
    }
    requestAnimationFrame(a);
  }
}

function selectObject(objectToSelect) {
  if (selectedForManipulation === objectToSelect && objectToSelect !== null) {
    // Already selected, ensure highlight is on
    // Re-apply highlight just in case (could be optimized if sure it's always on)
  } else {
    deselectObject(); // Deselect previous
  }

  if (!objectToSelect) {
    // Called with null, or previous deselect made it null
    selectedForManipulation = null; // Ensure state
    document.getElementById("delete-object-btn").style.display = "none";
    return;
  }

  selectedForManipulation = objectToSelect;
  document.getElementById("delete-object-btn").style.display = "flex";

  selectedForManipulation.traverse((c) => {
    if (c.isMesh && c.material) {
      const mats = Array.isArray(c.material) ? c.material : [c.material];
      mats.forEach((mat) => {
        if (!originalMaterials.has(mat.uuid)) {
          originalMaterials.set(mat.uuid, {
            e: mat.emissive ? mat.emissive.clone() : new THREE.Color(0),
            ei: mat.emissiveIntensity !== undefined ? mat.emissiveIntensity : 0,
          });
        }
        if (mat.isMeshStandardMaterial || mat.isMeshPhongMaterial) {
          mat.emissive = new THREE.Color(0x00cc00);
          mat.emissiveIntensity = 0.7;
          if (mat.needsUpdate !== undefined) mat.needsUpdate = true;
        }
      });
    }
  });
}

function deselectObject() {
  if (selectedForManipulation) {
    selectedForManipulation.traverse((c) => {
      if (c.isMesh && c.material) {
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        mats.forEach((mat) => {
          if (originalMaterials.has(mat.uuid)) {
            const oP = originalMaterials.get(mat.uuid);
            if (mat.isMeshStandardMaterial || mat.isMeshPhongMaterial) {
              mat.emissive.copy(oP.e);
              mat.emissiveIntensity = oP.ei;
              if (mat.needsUpdate !== undefined) mat.needsUpdate = true;
            }
            originalMaterials.delete(mat.uuid);
          }
        });
      }
    });
  }
  selectedForManipulation = null;
  document.getElementById("delete-object-btn").style.display = "none";
}

function handleObjectTapSelection(event) {
  if (!event.touches || event.touches.length === 0) return;
  const t = event.touches[0];
  tapPosition.x = (t.clientX / window.innerWidth) * 2 - 1;
  tapPosition.y = -(t.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(tapPosition, camera);
  const intersects = raycaster.intersectObjects(allPlacedObjects, true);
  if (intersects.length > 0) {
    let cRO = null;
    for (const i of intersects) {
      let o = i.object;
      while (o.parent && o.parent !== scene) o = o.parent;
      if (allPlacedObjects.includes(o)) {
        cRO = o;
        break;
      }
    }
    if (cRO) {
      if (selectedForManipulation !== cRO) selectObject(cRO);
      else selectObject(cRO); /*re-highlight if tapped same*/
    } else deselectObject();
  } else deselectObject();
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
    const rS = renderer.xr.getReferenceSpace();
    const s = renderer.xr.getSession();
    if (!hitTestSourceRequested && s) {
      s.requestReferenceSpace("viewer")
        .then((rSp) =>
          s
            .requestHitTestSource({ space: rSp })
            .then((src) => {
              hitTestSource = src;
            })
            .catch((e) => console.error("HTS E:", e))
        )
        .catch((e) => console.error("VRS E:", e));
      s.addEventListener("end", () => {
        hitTestSourceRequested = false;
        hitTestSource = null;
        planeFound = false;
        document.getElementById("tracking-prompt").style.display = "none";
        document.getElementById("bottom-controls").style.display = "none";
        deselectObject();
        allPlacedObjects.forEach((o) => scene.remove(o));
        allPlacedObjects = [];
        originalMaterials.clear();
        currentGlobalScale = DEFAULT_OBJECT_SCALE;
      });
      hitTestSourceRequested = true;
    }
    if (hitTestSource && rS) {
      const res = frame.getHitTestResults(hitTestSource);
      if (res.length) {
        if (!planeFound) {
          planeFound = true;
          document.getElementById("tracking-prompt").style.display = "none";
          document.getElementById("bottom-controls").style.display = "flex";
        }
        const p = res[0].getPose(rS);
        if (p) {
          reticle.visible = true;
          reticle.matrix.fromArray(p.transform.matrix);
        } else reticle.visible = false;
      } else reticle.visible = false;
    }
  }
  renderer.render(scene, camera);
}

function onTouchStart(event) {
  let tE = event.target;
  let isUI = false;
  while (tE && tE !== document.body) {
    if (
      tE.dataset?.ignoreTap === "true" ||
      tE.closest("#object-selector") ||
      tE.closest("#action-buttons")
    ) {
      isUI = true;
      break;
    }
    tE = tE.parentElement;
  }
  if (isUI) {
    moving = pinchScaling = pinchRotating = threeFingerMoving = false;
    return;
  }

  const selBeforeTap = selectedForManipulation;

  if (event.touches.length === 1) {
    handleObjectTapSelection(event); // This might change selectedForManipulation
    if (selectedForManipulation) {
      if (selectedForManipulation === selBeforeTap && selBeforeTap !== null) {
        // Was already selected and still is
        moving = true;
        initialTouchPosition = new THREE.Vector2(
          event.touches[0].pageX,
          event.touches[0].pageY
        );
      } else {
        // Selection changed or became null
        moving = false;
      }
    } else {
      // Nothing selected
      moving = false;
    }
    pinchScaling = pinchRotating = threeFingerMoving = false;
  } else if (event.touches.length === 2 && selectedForManipulation) {
    moving = false;
    threeFingerMoving = false;
    pinchScaling = true;
    pinchRotating = true;
    initialPinchDistance = getPinchDistance(event.touches);
    initialPinchAngle = getPinchAngle(event.touches);
    scaleAtPinchStart = selectedForManipulation.scale.x;
  } else if (event.touches.length === 3 && selectedForManipulation) {
    moving = false;
    pinchScaling = false;
    pinchRotating = false;
    threeFingerMoving = true;
    initialZObjectPosition = selectedForManipulation.position.y;
    initialZTouchY = event.touches[0].pageY;
  } else {
    moving = pinchScaling = pinchRotating = threeFingerMoving = false;
  }
}

function onTouchMove(event) {
  if (!selectedForManipulation) return;
  if (threeFingerMoving && event.touches.length === 3) {
    selectedForManipulation.position.y =
      initialZObjectPosition +
      (initialZTouchY - event.touches[0].pageY) * 0.005;
  } else if (pinchScaling && event.touches.length === 2) {
    const nD = getPinchDistance(event.touches);
    const nS = scaleAtPinchStart * (nD / initialPinchDistance);
    selectedForManipulation.scale.setScalar(nS);
    if (pinchRotating) {
      const nA = getPinchAngle(event.touches);
      selectedForManipulation.rotation.y += nA - initialPinchAngle;
      initialPinchAngle = nA;
    }
  } else if (moving && event.touches.length === 1) {
    const t = new THREE.Vector2(event.touches[0].pageX, event.touches[0].pageY);
    const dX = t.x - initialTouchPosition.x;
    const dY = t.y - initialTouchPosition.y;
    const cR = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    cR.y = 0;
    cR.normalize();
    const cF = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2);
    cF.negate();
    cF.y = 0;
    cF.normalize();
    const mX = cR.multiplyScalar(dX * MOVE_SENSITIVITY);
    const mZ = cF.multiplyScalar(-dY * MOVE_SENSITIVITY);
    selectedForManipulation.position.add(mX).add(mZ);
    initialTouchPosition.copy(t);
  }
}

function onTouchEnd(event) {
  if (threeFingerMoving && event.touches.length < 3) threeFingerMoving = false;
  if ((pinchScaling || pinchRotating) && event.touches.length < 2) {
    if (selectedForManipulation)
      currentGlobalScale = selectedForManipulation.scale.x;
    pinchScaling = false;
    pinchRotating = false;
  }
  if (moving && event.touches.length < 1) moving = false;
  if (event.touches.length === 0) {
    threeFingerMoving = pinchScaling = pinchRotating = moving = false;
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
