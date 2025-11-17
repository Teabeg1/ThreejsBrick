// ===== Imports =====
import * as THREE from "https://cdn.skypack.dev/three@0.129.0/build/three.module.js";
import { OrbitControls } from "https://cdn.skypack.dev/three@0.129.0/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "https://cdn.skypack.dev/three@0.129.0/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "https://cdn.skypack.dev/three@0.129.0/examples/jsm/loaders/DRACOLoader.js";
import { KTX2Loader } from "https://cdn.skypack.dev/three@0.129.0/examples/jsm/loaders/KTX2Loader.js";

// ===== DOM =====
const container = document.getElementById("container3D");
const modelSelect = document.getElementById("model-select");
const loadBtn = document.getElementById("loadBtn");
const resetBtn = document.getElementById("resetBtn");
const statusEl = document.getElementById("status");
const textureTypeRadios = document.querySelectorAll('input[name="textureType"]');
const textureVariantOptions = document.getElementById("texture-variant-options");
const applyOnceBtn = document.getElementById("applyOnceBtn"); // кнопка "Загрузить текстуру"

// ===== Настройка целевого материала и одноразового применения =====
const TARGET_MATERIAL_NAME = "Bricks026"; // ← на этот материал положим текстуру
let textureAppliedOnce = false;

// ===== Конфигурация (config.json) =====
let MODELS_CONFIG = {};
let TEXTURES_CONFIG = {};

// ===== Состояние =====
let currentModel = null;
const modelMaterials = new Map(); // name -> material object

// ===== Three.js: Scene / Camera / Renderer =====
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 50000);
camera.position.set(0, 2, 5);

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); // четкость, но без перегруза
if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
container.appendChild(renderer.domElement);

// Начальный размер — по реальному контейнеру
function sizeFromContainer() {
  const rect = container.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
sizeFromContainer();


// Lights
const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 0.8);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 1.0);
dir.position.set(5, 10, 7);
scene.add(dir);

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.enableRotate = true;
controls.enableZoom = true;
controls.screenSpacePanning = true;
controls.minDistance = 0.1;
controls.maxDistance = 100000;

// ===== Loaders =====
const loader = new GLTFLoader();

// (опционально, но полезно) поддержка Draco и KTX2
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath("https://cdn.skypack.dev/three@0.129.0/examples/js/libs/draco/");
loader.setDRACOLoader(dracoLoader);

const ktx2Loader = new KTX2Loader()
  .setTranscoderPath("https://cdn.skypack.dev/three@0.129.0/examples/js/libs/basis/")
  .detectSupport(renderer);
loader.setKTX2Loader(ktx2Loader);

// ===== Helpers =====
function disposeObject(obj) {
  obj.traverse((node) => {
    if (node.isMesh) {
      node.geometry?.dispose();
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      mats.forEach((m) => {
        if (!m) return;
        for (const k in m) {
          const v = m[k];
          if (v && v.isTexture) v.dispose?.();
        }
        m.dispose?.();
      });
    }
  });
}

function unloadCurrentModel() {
  if (!currentModel) return;
  scene.remove(currentModel);
  disposeObject(currentModel);
  currentModel = null;
  modelMaterials.clear();
}

function extractModelMaterials(model) {
  const materials = new Map();
  model.traverse((node) => {
    if (!node.isMesh) return;
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    mats.forEach((mat) => {
      if (mat && mat.name) materials.set(mat.name, mat);
    });
  });
  return materials;
}

function logSceneStructure(obj, depth = 0) {
  const indent = "  ".repeat(depth);
  console.log(
    `${indent}${obj.name || "unnamed"} (${obj.type})`,
    obj.isMesh ? `- Material: ${Array.isArray(obj.material) ? obj.material.map(m=>m?.name).join(", ") : (obj.material?.name || "no-name")}` : ""
  );
  if (obj.children) obj.children.forEach((child) => logSceneStructure(child, depth + 1));
}

function fitCameraToObject(obj, offset = 1.5) {
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) {
    console.warn("Объект пуст, структура:", obj);
    logSceneStructure(obj);
    camera.position.set(0, 2, 5);
    controls.target.set(0, 0, 0);
    controls.update();
    return;
  }

  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim === 0) return;

  const fov = (camera.fov * Math.PI) / 180;
  const cameraZ = (maxDim / (2 * Math.tan(fov / 2))) * offset;

  camera.position.set(center.x, center.y + maxDim * 0.5, center.z + cameraZ);
  camera.lookAt(center);
  camera.near = Math.max(0.01, cameraZ / 100);
  camera.far = Math.max(100, cameraZ * 5);
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.maxDistance = cameraZ * 10;
  controls.update();

  console.log("Модель загружена. Размер:", { x: size.x, y: size.y, z: size.z }, "Центр:", center);
}

// ===== Config =====
async function loadConfig() {
  try {
    const response = await fetch("./config.json");
    if (!response.ok) throw new Error(`Ошибка загрузки config.json: ${response.status}`);
    const config = await response.json();
    MODELS_CONFIG = config.models || {};
    TEXTURES_CONFIG = config.textures || {};
    console.log("Конфиг загружен успешно");
    return true;
  } catch (err) {
    console.error("Ошибка загрузки конфиг файла:", err);
    statusEl.textContent = "Ошибка загрузки конфигурации";
    return false;
  }
}

// ===== Загрузка модели по ключу =====
function loadModelByKey(key) {
  const cfg = MODELS_CONFIG[key];
  if (!cfg) return Promise.reject(new Error(`Неизвестный ключ модели: ${key}`));

  unloadCurrentModel();

  const attemptLoad = (path) =>
    new Promise((resolveAttempt, rejectAttempt) => {
      loader.load(
        path,
        (gltf) => resolveAttempt(gltf),
        undefined,
        (err) => {
          console.error(`GLTF load failed for ${path}:`, err);
          rejectAttempt(err);
        }
      );
    });

  return new Promise(async (resolve, reject) => {
    try {
      let gltf = null;
      try {
        gltf = await attemptLoad(cfg.path);
      } catch (err1) {
        if (cfg.fallback) {
          try {
            console.warn(`Пробуем fallback: ${cfg.fallback}`);
            gltf = await attemptLoad(cfg.fallback);
          } catch (err2) {
            throw err1;
          }
        } else {
          throw err1;
        }
      }

      if (!gltf) throw new Error("Не удалось загрузить модель");

      currentModel = gltf.scene;
      scene.add(currentModel);
      fitCameraToObject(currentModel, 1.5);

      modelMaterials.clear();
      const mats = extractModelMaterials(currentModel);
      mats.forEach((mat, name) => modelMaterials.set(name, mat));

      console.log(`Найдено материалов: ${modelMaterials.size}`);
      statusEl.textContent = `Загружена модель: ${cfg.name} `;
      resolve();
    } catch (err) {
      console.error(`Ошибка загрузки модели "${key}":`, err);
      statusEl.textContent = `Ошибка загрузки модели`;
      alert(`Не удалось загрузить модель "${cfg.name}". ${err.message}`);
      reject(err);
    }
  });
}

// ===== Текстуры по типу =====
function getTexturesByType(textureType) {
  return Object.entries(TEXTURES_CONFIG)
    .filter(([, cfg]) => cfg.tags.type === textureType)
    .map(([key, cfg]) => ({ key, ...cfg }));
}

function updateTextureVariants() {
  const selectedType = document.querySelector('input[name="textureType"]:checked')?.value;
  const variants = getTexturesByType(selectedType);

  textureVariantOptions.innerHTML = "";
  if (variants.length === 0) {
    textureVariantOptions.innerHTML = '<p style="opacity: 0.6;">Нет вариантов для этого типа</p>';
    return;
  }

  variants.forEach(({ key, name }) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "textureVariant";
    input.value = key;
    label.appendChild(input);
    label.appendChild(document.createTextNode(" " + name));
    textureVariantOptions.appendChild(label);
  });
}

function getSelectedTextureKey() {
  return document.querySelector('input[name="textureVariant"]:checked')?.value || null;
}

// ===== Применить выбранную текстуру к TARGET_MATERIAL_NAME (однократно) =====
function cloneTex(t) {
  if (!t) return null;
  const c = t.clone();
  c.needsUpdate = true;
  return c;
}

function applyTextureOnceToTarget(textureKey) {
  if (textureAppliedOnce) {
    statusEl.textContent = "Текстура уже применена (один раз).";
    return;
  }
  if (!currentModel) {
    statusEl.textContent = "Сначала загрузите модель.";
    return;
  }
  if (!TEXTURES_CONFIG[textureKey]) {
    statusEl.textContent = "Выберите вариант текстуры.";
    return;
  }

  const targetMat = modelMaterials.get(TARGET_MATERIAL_NAME);
  if (!targetMat) {
    statusEl.textContent = `Материал "${TARGET_MATERIAL_NAME}" не найден в модели.`;
    return;
  }

  const { path } = TEXTURES_CONFIG[textureKey];
  loader.load(
    path,
    (gltf) => {
      let srcMat = null;
      gltf.scene.traverse((n) => { if (n.isMesh && !srcMat) srcMat = n.material; });
      if (!srcMat) {
        statusEl.textContent = "Ошибка: текстурная сцена без мешей";
        return;
      }

      targetMat.map          = cloneTex(srcMat.map)          || targetMat.map;
      targetMat.normalMap    = cloneTex(srcMat.normalMap)    || targetMat.normalMap;
      targetMat.aoMap        = cloneTex(srcMat.aoMap)        || targetMat.aoMap;
      targetMat.roughnessMap = cloneTex(srcMat.roughnessMap) || targetMat.roughnessMap;
      targetMat.metalnessMap = cloneTex(srcMat.metalnessMap) || targetMat.metalnessMap;
      targetMat.needsUpdate  = true;

      disposeObject(gltf.scene);

      textureAppliedOnce = true;
      if (applyOnceBtn) applyOnceBtn.disabled = true;
      statusEl.textContent = `Текстура применена к "${TARGET_MATERIAL_NAME}" (один раз).`;
    },
    undefined,
    (err) => {
      console.error("Ошибка загрузки текстуры:", err);
      statusEl.textContent = "Ошибка загрузки текстуры";
    }
  );
}

// ===== UI =====
function initModelUI() {
  modelSelect.innerHTML = '<option value="">Выберите проект дома</option>';
  Object.entries(MODELS_CONFIG).forEach(([key, { name }]) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = name;
    modelSelect.appendChild(option);
  });
}

function updateLoadAvailability() {
  loadBtn.disabled = !modelSelect.value;
}

// ===== Init =====
async function initUI() {
  const configLoaded = await loadConfig();
  if (!configLoaded) {
    statusEl.textContent = "Ошибка загрузки конфигурации. Проверьте config.json";
    return;
  }
  modelSelect.addEventListener("change", () => {
    updateLoadAvailability();         // включает кнопку, если что-то выбрано
    statusEl.textContent = "";        // очистим статус при смене модели
  });
  textureTypeRadios.forEach((radio) => {
    radio.addEventListener("change", updateTextureVariants);
  });

  if (applyOnceBtn) {
    applyOnceBtn.addEventListener("click", () => {
      const key = getSelectedTextureKey();
      applyTextureOnceToTarget(key);
    });
  }

  loadBtn.addEventListener("click", async () => {
    const modelKey = modelSelect.value;
    if (!modelKey) return;
    statusEl.textContent = "Загружаю модель...";
    try {
      await loadModelByKey(modelKey);
      // каждый раз после загрузки модели разрешаем одно применение снова
      textureAppliedOnce = false;
      if (applyOnceBtn) applyOnceBtn.disabled = false;
    } catch (_) {}
  });

  resetBtn.addEventListener("click", () => {
    modelSelect.value = "";
    document.querySelectorAll('input[name="textureType"], input[name="textureVariant"]').forEach((el) => {
      el.checked = false;
    });
    unloadCurrentModel();
    textureVariantOptions.innerHTML = "";
    updateLoadAvailability();
    textureAppliedOnce = false;
    if (applyOnceBtn) applyOnceBtn.disabled = false;
    statusEl.textContent = "Выбор сброшен.";
  });

  initModelUI();
  updateLoadAvailability();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initUI);
} else {
  initUI();
}

// Подстраиваем камеру/рендер под КОНКРЕТНЫЙ блок с 3D
const ro = new ResizeObserver(() => {
  sizeFromContainer();
});
ro.observe(container);


function animate() {
  requestAnimationFrame(animate);

  // Страховка: если CSS изменил размер, а наблюдатель не сработал
  const rect = container.getBoundingClientRect();
  const needW = Math.max(1, Math.floor(rect.width));
  const needH = Math.max(1, Math.floor(rect.height));
  const canvas = renderer.domElement;
  if (canvas.width !== needW * renderer.getPixelRatio() || canvas.height !== needH * renderer.getPixelRatio()) {
    renderer.setSize(needW, needH, false);
    camera.aspect = needW / needH;
    camera.updateProjectionMatrix();
  }

  controls.update();
  renderer.render(scene, camera);
}
animate();