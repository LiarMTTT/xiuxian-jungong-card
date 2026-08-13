(function () {
  "use strict";

  const DEFAULT_WIDTH = 8192;
  const DEFAULT_HEIGHT = 5461;
  const ACCESS_RANK = {
    public: 0,
    travel: 1,
    faction: 2,
    deep: 3,
    "deep-secret": 3,
    author: 4,
    "world-truth": 4
  };
  const SEASONS = {
    spring: { label: "春", phrase: "万物生发", month: 4, color: "#8fb986" },
    summer: { label: "夏", phrase: "草木丰茂", month: 7, color: "#4baa71" },
    autumn: { label: "秋", phrase: "金风肃野", month: 10, color: "#c9904d" },
    winter: { label: "冬", phrase: "玄冰封疆", month: 1, color: "#b2d1d9" }
  };
  const MONTH_NAMES = ["正月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "冬月", "腊月"];
  const DAY_NAMES = [
    "初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十",
    "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
    "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十"
  ];
  const LOD_RESOLUTIONS = ["512", "1K", "2K", "4K", "8K"];

  const ASSET_PATHS = {
    data: [
      "../dist/data/map-data.json",
      "../dist/data/map.json",
      "../dist/map-data.json",
      "../dist/map.json"
    ],
    rasters: (season) => [
      `../dist/seasons/map-${season}-terrain-8192x5461.webp`,
      `../dist/seasons/map-${season}-terrain-8192x5461.png`,
      `../dist/seasons/map-${season}-8192x5461.webp`,
      `../dist/seasons/map-${season}-8192x5461.png`,
      `../dist/seasons/${season}.webp`,
      `../dist/seasons/${season}.png`,
      `../assets/maps/base/${season}.png`,
      `../assets/maps/seasons/${season}.png`
    ],
    previews: (season) => [
      `../dist/previews/map-${season}-terrain-8192x5461-preview-1024.webp`
    ],
    tileTemplates: (season) => [
      `../dist/tiles/${season}/{z}/{x}/{y}.webp`,
      `../dist/tiles/${season}/{z}/{x}/{y}.png`,
      `../assets/tiles/${season}/{z}/{x}/{y}.webp`
    ],
    manifest: ["../dist/tiles/manifest.json", "../dist/data/tile-manifest.json"],
    svg: (name) => {
      const aliases = {
        waterways: ["hydrology", "waterways"],
        roads: ["roads"],
        "sea-routes": ["sea-routes"]
      };
      const filenames = aliases[name] || [name];
      return filenames.flatMap((filename) => [`../dist/layers/${filename}.svg`, `../assets/layers/${filename}.svg`]);
    }
  };

  const els = {};
  const state = {
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    map: null,
    bounds: null,
    currentSeason: "spring",
    currentPreview: null,
    currentRaster: null,
    currentTiles: null,
    data: null,
    features: [],
    markers: [],
    geometries: [],
    svgLayers: new Map(),
    currentLod: 0,
    assetMode: "auto",
    tileAvailable: false,
    rasterAvailable: false,
    currentAssetKind: null,
    date: { year: 1, month: 4, day: 1 },
    lastAssetToken: 0,
    mapReady: false,
    selectedFeatureId: null
  };

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheElements();
    buildMonthOptions();
    bindUi();
    updateDateUi(false);

    if (!window.L) {
      setAssetStatus("missing", "Leaflet 未能载入");
      toast("本地 Leaflet 运行库缺失；请确认 preview/vendor/leaflet.js 存在。", true);
      return;
    }

    initLeaflet();
    loadSeasonAssets(state.currentSeason, false);
    Promise.allSettled([loadMapData(), loadManifest()]);
  }

  function cacheElements() {
    [
      "mapTitle", "mapSubtitle", "seasonPill", "assetStatus", "sidebar", "sidebarToggle", "sidebarClose",
      "sidebarScrim", "resetLayers", "accessLevel", "assetMode", "dataFile", "loadNote", "mapDimensions",
      "dataVersion", "mapViewport", "mapPlaceholder", "leafletMap", "seasonAtmosphere", "zoomIn", "zoomOut",
      "fitMap", "lodValue", "zoomReadout", "coordinateReadout", "featureCard", "featureClose", "featureKicker",
      "featureName", "featureDescription", "featureMeta", "interactionHint", "worldDateText", "seasonText",
      "worldYear", "worldMonth", "worldDay", "seasonTrack", "advanceMonth", "toastRegion"
    ].forEach((id) => { els[id] = document.getElementById(id); });
  }

  function buildMonthOptions() {
    els.worldMonth.innerHTML = MONTH_NAMES.map((name, index) =>
      `<option value="${index + 1}">${index + 1}月 · ${name}</option>`
    ).join("");
  }

  function bindUi() {
    els.zoomIn.addEventListener("click", () => state.map && state.map.zoomIn());
    els.zoomOut.addEventListener("click", () => state.map && state.map.zoomOut());
    els.fitMap.addEventListener("click", () => fitMap(true));
    els.featureClose.addEventListener("click", closeFeatureCard);
    els.assetMode.addEventListener("change", () => {
      state.assetMode = els.assetMode.value;
      loadSeasonAssets(state.currentSeason, false);
    });
    els.accessLevel.addEventListener("change", updateVisibility);
    els.resetLayers.addEventListener("click", resetLayers);
    els.dataFile.addEventListener("change", importDataFile);
    els.worldYear.addEventListener("change", readDateControls);
    els.worldMonth.addEventListener("change", readDateControls);
    els.worldDay.addEventListener("change", readDateControls);
    els.advanceMonth.addEventListener("click", advanceMonth);
    els.seasonTrack.querySelectorAll("button[data-season]").forEach((button) => {
      button.addEventListener("click", () => jumpToSeason(button.dataset.season));
    });
    document.querySelectorAll("input[data-layer]").forEach((input) => {
      input.addEventListener("change", () => toggleLayer(input.dataset.layer, input.checked));
    });
    els.sidebarToggle.addEventListener("click", openSidebar);
    els.sidebarClose.addEventListener("click", closeSidebar);
    els.sidebarScrim.addEventListener("click", closeSidebar);
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeFeatureCard();
        closeSidebar();
      }
    });
  }

  function initLeaflet() {
    const initialZoom = window.innerWidth <= 820 ? -2.25 : -1.5;
    state.map = L.map(els.leafletMap, {
      crs: L.CRS.Simple,
      zoomControl: false,
      attributionControl: false,
      minZoom: -4,
      maxZoom: 0,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 120,
      wheelDebounceTime: 40,
      zoomAnimation: true,
      fadeAnimation: true,
      markerZoomAnimation: true,
      inertia: true,
      inertiaDeceleration: 2600,
      inertiaMaxSpeed: 1500,
      preferCanvas: true,
      keyboardPanDelta: 120,
      maxBoundsViscosity: 0.62
    });
    createPanes();
    updateBounds();
    state.map.setView(pixelToLatLng(state.width * 0.52, state.height * 0.49), initialZoom);
    state.map.on("zoomend", updateLod);
    state.map.on("mousemove", updateCoordinateReadout);
    state.map.on("mouseout", () => { els.coordinateReadout.textContent = "X — · Y —"; });
    state.map.on("movestart zoomstart", dismissInteractionHint);
    state.map.on("click", closeFeatureCard);
    state.mapReady = true;
    updateLod();
  }

  function createPanes() {
    [
      ["seasonPreviewPane", 180, "season-preview-pane"],
      ["seasonRasterPane", 200, "season-raster-pane"],
      ["seasonRasterIncomingPane", 205, "season-raster-pane-incoming"],
      ["influencePane", 330, "influence-pane"],
      ["boundaryPane", 350, "boundary-pane"],
      ["routePane", 360, "route-pane"],
      ["markerPaneCustom", 410, "marker-pane"],
      ["labelPaneCustom", 420, "label-pane"]
    ].forEach(([name, zIndex, className]) => {
      const pane = state.map.createPane(name);
      pane.style.zIndex = String(zIndex);
      pane.classList.add(className);
    });
  }

  function updateBounds() {
    state.bounds = L.latLngBounds(pixelToLatLng(0, 0), pixelToLatLng(state.width, state.height));
    if (state.map) {
      state.map.setMaxBounds(state.bounds.pad(0.35));
    }
    els.mapDimensions.textContent = `${state.width} × ${state.height}`;
  }

  function pixelToLatLng(x, y) {
    return L.latLng(-Number(y || 0), Number(x || 0));
  }

  function latLngToPixel(latlng) {
    return { x: Math.round(latlng.lng), y: Math.round(-latlng.lat) };
  }

  async function loadMapData() {
    let lastError = null;
    for (const path of ASSET_PATHS.data) {
      try {
        const response = await fetchWithTimeout(path, { cache: "no-cache" }, 30000);
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const json = await response.json();
        applyMapData(json, path);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    const fileProtocol = window.location.protocol === "file:";
    els.loadNote.innerHTML = fileProtocol
      ? "浏览器阻止了 <code>file://</code> JSON 读取；请用下方按钮导入，或按 README 启动本地静态服务。"
      : "没有找到地图数据；底图仍可独立预览，也可手动导入 JSON。";
    els.dataVersion.textContent = "未载入数据";
    if (!fileProtocol && lastError) console.info("Map data probe finished without match:", lastError.message);
  }

  function applyMapData(raw, sourceLabel) {
    const normalized = normalizeMapData(raw);
    state.data = raw;
    state.width = normalized.width;
    state.height = normalized.height;
    state.features = normalized.features;
    updateBounds();
    clearDataLayers();
    renderFeatures(normalized.features);
    renderGeometry(normalized.geometry);
    loadStaticSvgLayers();
    updateVisibility();
    els.mapTitle.textContent = normalized.title || "九域山河";
    els.mapSubtitle.textContent = normalized.subtitle || "8K 分层世界地图 · 云端交互检视台";
    els.dataVersion.textContent = normalized.version || `已载入 ${normalized.features.length} 个节点`;
    els.loadNote.innerHTML = `已载入 <code>${escapeHtml(sourceLabel)}</code>`;
    if (state.mapReady) state.map.panInsideBounds(state.bounds, { animate: false });
  }

  function normalizeMapData(raw) {
    const meta = raw.meta || raw.metadata || {};
    const coordinateSystem = raw.coordinateSystem || raw.coordinates || {};
    const dimensions = raw.dimensions || meta.dimensions || meta.canvas || {};
    const width = Number(dimensions.width || coordinateSystem.width || raw.width || DEFAULT_WIDTH);
    const height = Number(dimensions.height || coordinateSystem.height || raw.height || DEFAULT_HEIGHT);
    const features = [];
    const geometry = [];
    const factionNames = new Map((raw.factions || []).map((item) => [item.id, item.name]));
    const regionNames = new Map((raw.regions || []).map((item) => [item.id, item.name]));

    const pushFeature = (item, defaults) => {
      if (!item) return;
      const coords = item.coordinates || item.position || item.labelPosition || item.coordinate || {};
      let x = Number(Array.isArray(coords) ? coords[0] : (coords.x ?? item.x));
      let y = Number(Array.isArray(coords) ? coords[1] : (coords.y ?? item.y));
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const normalizedCoords = coordinateSystem.normalized === true || (x >= 0 && x <= 1 && y >= 0 && y <= 1 && item.pixelCoordinates !== true);
      if (normalizedCoords) { x *= width; y *= height; }
      const lod = item.lod || {};
      const factionIds = item.factionIds || item.factions || [];
      const regionId = item.regionId || item.region || "";
      const factionSubtitle = factionIds.map((id) => factionNames.get(id)).filter(Boolean).join(" · ");
      features.push({
        id: item.id || `${defaults.kind}-${features.length + 1}`,
        name: item.name || item.label || "未命名地点",
        subtitle: item.subtitle || item.regionName || factionSubtitle || regionNames.get(regionId) || "",
        x,
        y,
        kind: item.kind || item.type || defaults.kind,
        glyph: item.glyph || glyphForKind(item.kind || item.type || defaults.kind),
        minLod: clamp(Number(lod.min ?? item.minLod ?? item.minZoom ?? defaults.minLod), 0, 4),
        maxLod: clamp(Number(lod.max ?? item.maxLod ?? item.maxZoom ?? 4), 0, 4),
        priority: Number(lod.priority ?? item.priority ?? defaults.priority),
        access: normalizeAccess(item.visibility || item.access || item.accessLevel || defaults.access),
        description: item.description || "",
        factionIds,
        factionNames: factionIds.map((id) => factionNames.get(id) || id),
        regionId,
        regionName: regionNames.get(regionId) || regionId,
        tags: item.tags || [],
        seasonalTraits: item.seasonalTraits || item.seasonal || null,
        regionLabel: defaults.regionLabel || item.kind === "region"
      });
    };

    (raw.regions || []).forEach((item) => pushFeature(item, { kind: "region", minLod: 0, priority: 100, access: "public", regionLabel: true }));
    (raw.factions || []).forEach((item) => {
      if (item.coordinates || item.position || Number.isFinite(item.x)) pushFeature(item, { kind: "faction", minLod: 1, priority: 90, access: "public" });
    });
    (raw.nodes || raw.features || raw.locations || []).forEach((item) => pushFeature(item, { kind: "node", minLod: 2, priority: 60, access: "travel" }));

    const geometrySources = raw.geometry || raw.layers || raw.routes || [];
    if (Array.isArray(geometrySources)) {
      geometrySources.forEach((item) => geometry.push(normalizeGeometry(item, width, height, coordinateSystem.normalized === true)));
    } else if (geometrySources && typeof geometrySources === "object") {
      Object.entries(geometrySources).forEach(([type, items]) => {
        (Array.isArray(items) ? items : []).forEach((item) => geometry.push(normalizeGeometry({ ...item, type: item.type || type }, width, height, coordinateSystem.normalized === true)));
      });
    }

    return {
      width,
      height,
      title: meta.title || raw.title,
      subtitle: meta.subtitle || raw.subtitle,
      version: meta.version || raw.version,
      features,
      geometry: geometry.filter(Boolean)
    };
  }

  function normalizeGeometry(item, width, height, declaredNormalized) {
    if (!item) return null;
    const rawPoints = item.points || item.coordinates || item.path || [];
    if (!Array.isArray(rawPoints) || rawPoints.length < 2) return null;
    const points = rawPoints.map((point) => {
      let x = Number(Array.isArray(point) ? point[0] : point.x);
      let y = Number(Array.isArray(point) ? point[1] : point.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      if (declaredNormalized || (x >= 0 && x <= 1 && y >= 0 && y <= 1)) { x *= width; y *= height; }
      return [x, y];
    }).filter(Boolean);
    return {
      type: normalizeLayerType(item.type || item.layer || "roads"),
      points,
      polygon: Boolean(item.polygon || item.closed || ["influence", "danger"].includes(item.type)),
      access: normalizeAccess(item.visibility || item.access || "travel"),
      minLod: clamp(Number(item.minLod ?? item.minZoom ?? 0), 0, 4),
      maxLod: clamp(Number(item.maxLod ?? item.maxZoom ?? 4), 0, 4)
    };
  }

  function clearDataLayers() {
    state.markers.forEach((entry) => state.map.removeLayer(entry.layer));
    state.geometries.forEach((entry) => state.map.removeLayer(entry.layer));
    state.svgLayers.forEach((layer) => state.map.removeLayer(layer));
    state.markers = [];
    state.geometries = [];
    state.svgLayers.clear();
  }

  function renderFeatures(features) {
    features.forEach((feature) => {
      const markerHtml = feature.regionLabel ? "" : `<button class="marker-button" type="button" aria-label="查看${escapeHtml(feature.name)}">${markerArtForKind(feature.kind)}</button>`;
      const subtitleHtml = feature.subtitle ? `<small>${escapeHtml(feature.subtitle)}</small>` : "";
      const html = `<div class="map-feature-anchor" data-kind="${escapeHtml(feature.kind)}">${markerHtml}<span class="feature-label">${escapeHtml(feature.name)}${subtitleHtml}</span></div>`;
      const icon = L.divIcon({ className: `map-feature-icon${feature.regionLabel ? " region-label" : ""}`, html, iconSize: [0, 0] });
      const layer = L.marker(pixelToLatLng(feature.x, feature.y), {
        icon,
        pane: feature.regionLabel ? "labelPaneCustom" : "markerPaneCustom",
        keyboard: false,
        riseOnHover: true
      });
      layer.addTo(state.map);
      layer.on("click", (event) => {
        if (event.originalEvent) L.DomEvent.stopPropagation(event.originalEvent);
        selectFeature(feature);
      });
      const el = layer.getElement();
      if (el) {
        el.dataset.kind = feature.kind;
        if (feature.regionLabel) el.classList.add("region-label");
      }
      state.markers.push({ layer, feature });
    });
  }

  function renderGeometry(items) {
    items.forEach((item) => {
      if (!item || item.points.length < 2) return;
      const latlngs = item.points.map(([x, y]) => pixelToLatLng(x, y));
      const pane = item.type === "influence" ? "influencePane" : (["roads", "sea-routes"].includes(item.type) ? "routePane" : "boundaryPane");
      const options = { pane, className: `layer-${item.type}`, interactive: false, weight: 1.2, opacity: 0.85 };
      const layer = item.polygon ? L.polygon(latlngs, options) : L.polyline(latlngs, options);
      layer.addTo(state.map);
      state.geometries.push({ layer, feature: item });
    });
  }

  function loadStaticSvgLayers() {
    ["waterways", "boundaries", "roads", "sea-routes"].forEach((name) => addSvgOverlay(name));
  }

  function addSvgOverlay(name) {
    const path = ASSET_PATHS.svg(name)[0];
    const pane = ["roads", "sea-routes"].includes(name) ? "routePane" : "boundaryPane";
    const overlay = L.imageOverlay(path, state.bounds, { pane, opacity: 0.88, interactive: false, className: `static-layer layer-${name}` });
    overlay.once("error", () => {
      if (state.map.hasLayer(overlay)) state.map.removeLayer(overlay);
      state.svgLayers.delete(name);
    });
    overlay.addTo(state.map);
    state.svgLayers.set(name, overlay);
    updateLayerClass(name);
  }

  async function loadManifest() {
    for (const path of ASSET_PATHS.manifest) {
      try {
        const response = await fetchWithTimeout(path, { cache: "no-cache" }, 30000);
        if (!response.ok) continue;
        const manifest = await response.json();
        const dimensions = manifest.dimensions || manifest.map || {};
        const width = Number(manifest.width || dimensions.width);
        const height = Number(manifest.height || dimensions.height);
        if (Number.isFinite(width) && Number.isFinite(height) && !state.data) {
          state.width = width;
          state.height = height;
          updateBounds();
        }
        return manifest;
      } catch (_) { /* next path */ }
    }
    return null;
  }

  async function loadSeasonAssets(season, animate) {
    const token = ++state.lastAssetToken;
    setAssetStatus("loading", `载入${SEASONS[season].label}季地图`);
    const mode = state.assetMode;
    state.currentAssetKind = null;

    const previewPromise = loadPreview(season, token);
    const detailPromise = mode === "raster"
      ? tryLoadRaster(season, token, animate)
      : tryLoadTiles(season, token);
    const [previewLoaded, detailLoaded] = await Promise.all([previewPromise, detailPromise]);
    if (token !== state.lastAssetToken) return;

    const loaded = previewLoaded || detailLoaded;
    state.rasterAvailable = detailLoaded && state.currentAssetKind === "raster";
    state.tileAvailable = detailLoaded && state.currentAssetKind === "tiles";
    els.mapPlaceholder.classList.toggle("loaded", loaded);
    els.leafletMap.setAttribute("aria-hidden", loaded ? "false" : "true");

    if (!loaded) {
      setAssetStatus("missing", `${SEASONS[season].label}季地图载入失败，请刷新重试`);
      state.currentAssetKind = null;
      return;
    }
    if (state.currentAssetKind === "tiles") {
      setAssetStatus("ready", "LOD 瓦片已就绪");
    } else if (state.currentAssetKind === "raster") {
      setAssetStatus("ready", "8K 整图已载入");
    } else {
      setAssetStatus("fallback", "轻量预览已显示 · LOD 继续加载");
    }
  }

  function loadPreview(season, token) {
    const path = ASSET_PATHS.previews(season)[0];
    const incoming = L.imageOverlay(path, state.bounds, {
      pane: "seasonPreviewPane",
      opacity: 1,
      interactive: false,
      className: `season-preview season-${season}`
    });

    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        resolve(value);
      };
      const timeoutId = window.setTimeout(() => finish(false), 60000);
      incoming.once("load", () => {
        if (token !== state.lastAssetToken) {
          if (state.map.hasLayer(incoming)) state.map.removeLayer(incoming);
          finish(false);
          return;
        }
        if (state.currentAssetKind === "tiles" || state.currentAssetKind === "raster") {
          if (state.map.hasLayer(incoming)) state.map.removeLayer(incoming);
          finish(true);
          return;
        }
        if (state.currentPreview && state.map.hasLayer(state.currentPreview)) state.map.removeLayer(state.currentPreview);
        state.currentPreview = incoming;
        if (state.currentAssetKind !== "tiles" && state.currentAssetKind !== "raster") state.currentAssetKind = "preview";
        markMapVisible();
        if (state.currentAssetKind === "preview") setAssetStatus("loading", "轻量预览已显示 · 加载 LOD");
        finish(true);
      });
      incoming.once("error", () => {
        if (state.map.hasLayer(incoming)) state.map.removeLayer(incoming);
        finish(false);
      });
      incoming.addTo(state.map);
    });
  }

  function tryLoadTiles(season, token) {
    const template = ASSET_PATHS.tileTemplates(season)[0];
    if (state.currentTiles && state.map.hasLayer(state.currentTiles)) state.map.removeLayer(state.currentTiles);
    if (state.currentRaster && state.map.hasLayer(state.currentRaster)) state.map.removeLayer(state.currentRaster);
    state.currentTiles = null;
    state.currentRaster = null;

    const layer = L.tileLayer(template, {
      pane: "tilePane",
      minZoom: -4,
      maxZoom: 0,
      minNativeZoom: -4,
      maxNativeZoom: 0,
      zoomOffset: 4,
      tileSize: 512,
      noWrap: true,
      bounds: state.bounds,
      keepBuffer: 2,
      updateWhenIdle: true,
      updateWhenZooming: false,
      errorTileUrl: ""
    });

    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      layer.on("tileload", () => {
        if (token !== state.lastAssetToken || state.currentTiles !== layer) return;
        state.currentAssetKind = "tiles";
        markMapVisible();
        setAssetStatus("ready", "LOD 瓦片已就绪");
        finish(true);
      });
      layer.once("load", () => {
        if (token !== state.lastAssetToken || state.currentTiles !== layer) return;
        if (state.currentPreview && state.map.hasLayer(state.currentPreview)) {
          state.map.removeLayer(state.currentPreview);
        }
        state.currentPreview = null;
      });
      layer.on("tileerror", () => {
        if (token === state.lastAssetToken && state.currentAssetKind !== "tiles") {
          setAssetStatus("loading", "网络较慢 · 保留轻量预览");
        }
      });
      window.setTimeout(() => finish(false), 45000);
      layer.addTo(state.map);
      state.currentTiles = layer;
    });
  }

  function tryLoadRaster(season, token) {
    const path = ASSET_PATHS.rasters(season)[0];
    const incoming = L.imageOverlay(path, state.bounds, {
      pane: "seasonRasterPane",
      opacity: 1,
      interactive: false,
      className: `season-raster season-${season}`
    });

    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        resolve(value);
      };
      const timeoutId = window.setTimeout(() => finish(false), 90000);
      incoming.once("load", () => {
        if (token !== state.lastAssetToken) {
          if (state.map.hasLayer(incoming)) state.map.removeLayer(incoming);
          finish(false);
          return;
        }
        if (state.currentTiles && state.map.hasLayer(state.currentTiles)) state.map.removeLayer(state.currentTiles);
        if (state.currentRaster && state.map.hasLayer(state.currentRaster)) state.map.removeLayer(state.currentRaster);
        if (state.currentPreview && state.map.hasLayer(state.currentPreview)) state.map.removeLayer(state.currentPreview);
        state.currentTiles = null;
        state.currentPreview = null;
        state.currentRaster = incoming;
        state.currentAssetKind = "raster";
        markMapVisible();
        finish(true);
      });
      incoming.once("error", () => {
        if (state.map.hasLayer(incoming)) state.map.removeLayer(incoming);
        finish(false);
      });
      incoming.addTo(state.map);
    });
  }

  function markMapVisible() {
    els.mapPlaceholder.classList.add("loaded");
    els.leafletMap.setAttribute("aria-hidden", "false");
  }

  function toggleLayer(name, visible) {
    if (name === "weather") {
      els.seasonAtmosphere.classList.toggle("hidden", !visible);
      return;
    }
    els.leafletMap.classList.toggle(`hide-${name}`, !visible);
    const svg = state.svgLayers.get(name);
    if (svg) {
      if (visible && !state.map.hasLayer(svg)) svg.addTo(state.map);
      if (!visible && state.map.hasLayer(svg)) state.map.removeLayer(svg);
    }
    updateVisibility();
  }

  function updateLayerClass(name) {
    const input = document.querySelector(`input[data-layer="${name}"]`);
    toggleLayer(name, input ? input.checked : true);
  }

  function resetLayers() {
    const defaults = { weather: true, waterways: false, boundaries: false, roads: false, "sea-routes": false, influence: false, markers: true, labels: true, danger: false };
    document.querySelectorAll("input[data-layer]").forEach((input) => {
      input.checked = defaults[input.dataset.layer] !== false;
      toggleLayer(input.dataset.layer, input.checked);
    });
    els.accessLevel.value = "travel";
    updateVisibility();
    toast("图层和情报视图已恢复默认。", false);
  }

  function updateLod() {
    if (!state.map) return;
    const zoom = state.map.getZoom();
    const lod = clamp(Math.floor(zoom + 4.25), 0, 4);
    state.currentLod = lod;
    els.lodValue.textContent = String(lod);
    els.lodValue.title = `LOD ${lod} · ${LOD_RESOLUTIONS[lod]} 源图层`;
    els.zoomReadout.textContent = `${Math.round(Math.pow(2, zoom) * 100)}% · ${LOD_RESOLUTIONS[lod]}`;
    updateVisibility();
  }

  function updateVisibility() {
    const access = els.accessLevel ? els.accessLevel.value : "travel";
    const rank = ACCESS_RANK[access] ?? 1;
    const labelsVisible = document.querySelector('input[data-layer="labels"]')?.checked !== false;
    const markersVisible = document.querySelector('input[data-layer="markers"]')?.checked !== false;
    const dangerVisible = document.querySelector('input[data-layer="danger"]')?.checked !== false;

    state.markers.forEach(({ layer, feature }) => {
      const el = layer.getElement();
      if (!el) return;
      const accessAllowed = (ACCESS_RANK[feature.access] ?? 1) <= rank;
      const lodAllowed = state.currentLod >= feature.minLod && state.currentLod <= feature.maxLod;
      const priorityAllowed = presentationAllowsFeature(feature);
      const kindAllowed = !feature.kind.includes("danger") || dangerVisible;
      el.classList.toggle("access-hidden", !accessAllowed);
      el.classList.toggle("lod-hidden", !(lodAllowed && priorityAllowed && kindAllowed));
      const markerButton = el.querySelector(".marker-button");
      const label = el.querySelector(".feature-label");
      if (markerButton) markerButton.style.display = markersVisible ? "" : "none";
      if (label) label.style.display = labelsVisible ? "" : "none";
    });

    state.geometries.forEach(({ layer, feature }) => {
      const accessAllowed = (ACCESS_RANK[feature.access] ?? 1) <= rank;
      const lodAllowed = state.currentLod >= feature.minLod && state.currentLod <= feature.maxLod;
      const input = document.querySelector(`input[data-layer="${feature.type}"]`);
      const layerAllowed = !input || input.checked;
      const shouldShow = accessAllowed && lodAllowed && layerAllowed;
      if (shouldShow && !state.map.hasLayer(layer)) layer.addTo(state.map);
      if (!shouldShow && state.map.hasLayer(layer)) state.map.removeLayer(layer);
    });
  }

  function showFeatureCard(feature) {
    els.featureKicker.textContent = feature.regionLabel ? "九域地理" : kindLabel(feature.kind);
    els.featureName.textContent = feature.name;
    const seasonal = feature.seasonalTraits && (feature.seasonalTraits[state.currentSeason] || feature.seasonalTraits[SEASONS[state.currentSeason].label]);
    els.featureDescription.textContent = seasonal ? `${feature.description || ""}${feature.description ? "\n\n" : ""}${seasonal}` : (feature.description || "该地点暂未编写公开说明。");
    const meta = [];
    if (feature.regionId) meta.push(["所属区域", feature.regionName || feature.regionId]);
    if (feature.factionIds && feature.factionIds.length) meta.push(["关联势力", (feature.factionNames || feature.factionIds).join("、")]);
    if (feature.tags && feature.tags.length) meta.push(["地点标签", feature.tags.join("、")]);
    meta.push(["可见权限", accessLabel(feature.access)]);
    meta.push(["像素坐标", `${Math.round(feature.x)}, ${Math.round(feature.y)}`]);
    els.featureMeta.innerHTML = meta.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`).join("");
    els.featureCard.hidden = false;
  }

  function selectFeature(feature) {
    state.selectedFeatureId = feature.id;
    state.markers.forEach(({ layer, feature: markerFeature }) => {
      const el = layer.getElement();
      if (el) el.classList.toggle("selected", markerFeature.id === feature.id);
    });
    showFeatureCard(feature);
  }

  function closeFeatureCard() {
    state.selectedFeatureId = null;
    state.markers.forEach(({ layer }) => layer.getElement()?.classList.remove("selected"));
    els.featureCard.hidden = true;
  }

  function presentationAllowsFeature(feature) {
    if (feature.regionLabel) return state.currentLod <= 1;
    if (state.currentLod < 2) return false;

    const capitalKinds = new Set(["capital", "undersea-capital", "mobile-capital", "island-capital-port"]);
    if (state.currentLod === 2) return capitalKinds.has(feature.kind);

    const majorKinds = new Set(["faction-seat", "treaty-seat", "trade-metropolis", "craft-metropolis"]);
    if (state.currentLod === 3) return capitalKinds.has(feature.kind) || (majorKinds.has(feature.kind) && feature.priority >= 90);

    return feature.priority >= 74;
  }

  function markerArtForKind(kind) {
    const isCapital = ["capital", "undersea-capital", "island-capital-port"].includes(kind);
    if (kind === "mobile-capital") {
      return '<svg class="marker-art" viewBox="0 0 48 48" aria-hidden="true"><path d="M7 28h27l7-7-3 11-8 6H15L7 28Z"/><path d="M14 26V13l12 13M27 25V8l11 17"/><path d="M12 39c8 4 18 4 25 0"/></svg>';
    }
    if (kind === "faction-seat" || kind === "treaty-seat") {
      return '<svg class="marker-art" viewBox="0 0 48 48" aria-hidden="true"><path d="M6 38 18 13l6 10 5-8 13 23"/><path d="M14 31h20M18 26h12M21 21h6"/><path d="M18 38V28h12v10"/></svg>';
    }
    if (kind.includes("port") || kind.includes("sea") || kind.includes("island") || kind.includes("undersea")) {
      return '<svg class="marker-art" viewBox="0 0 48 48" aria-hidden="true"><path d="M10 27h28M14 27V17h20v10M19 17l5-7 5 7"/><path d="M7 34c5-4 10 4 16 0s11 4 18 0M9 40c5-4 10 4 16 0s10 4 14 0"/></svg>';
    }
    if (isCapital || kind.includes("city") || kind.includes("metropolis")) {
      return '<svg class="marker-art" viewBox="0 0 48 48" aria-hidden="true"><path d="M7 23h34L34 17H14l-7 6ZM12 30h24l-5-7H17l-5 7Z"/><path d="M16 30v10h16V30M21 40V30h6v10M18 17l6-8 6 8"/></svg>';
    }
    return '<svg class="marker-art" viewBox="0 0 48 48" aria-hidden="true"><path d="M10 25h28l-6-6H16l-6 6ZM15 25v14h18V25M20 39v-9h8v9"/><circle cx="24" cy="13" r="4"/></svg>';
  }

  function readDateControls() {
    state.date.year = clamp(parseInt(els.worldYear.value, 10) || 1, 1, 9999);
    state.date.month = clamp(parseInt(els.worldMonth.value, 10) || 1, 1, 12);
    state.date.day = clamp(parseInt(els.worldDay.value, 10) || 1, 1, 30);
    updateDateUi(true);
  }

  function updateDateUi(allowSeasonChange) {
    const season = seasonFromMonth(state.date.month);
    els.worldYear.value = String(state.date.year);
    els.worldMonth.value = String(state.date.month);
    els.worldDay.value = String(state.date.day);
    els.worldDateText.textContent = `${yearToChinese(state.date.year)}年 ${MONTH_NAMES[state.date.month - 1]} ${DAY_NAMES[state.date.day - 1]}`;
    els.seasonText.textContent = `${SEASONS[season].label}季 · ${SEASONS[season].phrase}`;
    els.seasonTrack.querySelectorAll("button[data-season]").forEach((button) => button.classList.toggle("active", button.dataset.season === season));
    els.seasonPill.dataset.season = season;
    els.seasonPill.querySelector("span").textContent = `${SEASONS[season].label} · ${SEASONS[season].phrase}`;
    if (allowSeasonChange && season !== state.currentSeason) setSeason(season, true);
  }

  function setSeason(season, animate) {
    if (!SEASONS[season]) return;
    state.currentSeason = season;
    els.leafletMap.classList.remove("season-spring", "season-summer", "season-autumn", "season-winter");
    els.leafletMap.classList.add(`season-${season}`);
    loadSeasonAssets(season, animate);
    closeFeatureCard();
  }

  function jumpToSeason(season) {
    state.date.month = SEASONS[season].month;
    updateDateUi(true);
  }

  function advanceMonth() {
    state.date.month += 1;
    if (state.date.month > 12) { state.date.month = 1; state.date.year += 1; }
    updateDateUi(true);
  }

  function seasonFromMonth(month) {
    if (month >= 3 && month <= 5) return "spring";
    if (month >= 6 && month <= 8) return "summer";
    if (month >= 9 && month <= 11) return "autumn";
    return "winter";
  }

  function fitMap(animate) {
    if (!state.map || !state.bounds) return;
    state.map.fitBounds(state.bounds, { padding: [24, 24], animate: Boolean(animate), duration: .45 });
  }

  function updateCoordinateReadout(event) {
    const point = latLngToPixel(event.latlng);
    if (point.x < 0 || point.x > state.width || point.y < 0 || point.y > state.height) {
      els.coordinateReadout.textContent = "地图边界之外";
      return;
    }
    els.coordinateReadout.textContent = `X ${point.x} · Y ${point.y}`;
  }

  function dismissInteractionHint() {
    els.interactionHint.classList.add("dismissed");
  }

  async function importDataFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      applyMapData(json, file.name);
      toast(`已导入 ${file.name}。`, false);
    } catch (error) {
      toast(`地图数据导入失败：${error.message}`, true);
    } finally {
      event.target.value = "";
    }
  }

  function setAssetStatus(status, label) {
    els.assetStatus.dataset.state = status;
    els.assetStatus.querySelector("span").textContent = label;
  }

  function openSidebar() { els.sidebar.classList.add("open"); els.sidebarScrim.classList.add("visible"); }
  function closeSidebar() { els.sidebar.classList.remove("open"); els.sidebarScrim.classList.remove("visible"); }

  function toast(message, error) {
    const element = document.createElement("div");
    element.className = `toast${error ? " error" : ""}`;
    element.textContent = message;
    els.toastRegion.appendChild(element);
    window.setTimeout(() => element.remove(), 4300);
  }

  async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  function normalizeAccess(value) {
    const key = String(value || "travel").toLowerCase().replace(/_/g, "-");
    if (key === "deep-secret" || key === "secret" || key === "deep") return "deep-secret";
    if (key === "world-truth" || key === "truth" || key === "author") return "world-truth";
    if (key === "faction") return "faction";
    if (key === "public") return "public";
    return "travel";
  }

  function normalizeLayerType(value) {
    const key = String(value || "roads").toLowerCase().replace(/_/g, "-");
    const aliases = { route: "roads", routes: "roads", road: "roads", sea: "sea-routes", "sea-route": "sea-routes", boundary: "boundaries", water: "waterways", hydrology: "waterways" };
    return aliases[key] || key;
  }

  function glyphForKind(kind) {
    return ({
      faction: "宗", capital: "都", "undersea-capital": "都", "mobile-capital": "都", "island-capital-port": "都",
      city: "城", "trade-metropolis": "商", "craft-metropolis": "工", "caravan-city": "城",
      "faction-seat": "宗", port: "港", "amphibious-port": "港", "transport-hub": "驿",
      "mountain-pass": "关", "treaty-seat": "盟", "civilian-heartland": "田", "river-corridor": "河",
      danger: "险", "danger-zone": "险", "resource-danger-zone": "泽", "anomaly-zone": "异", "mobile-anomaly": "异",
      ruin: "遗", "ruin-zone": "遗", resource: "矿", "resource-zone": "矿", "industrial-resource-zone": "矿",
      "sea-route-gate": "门", "sea-lane-hub": "航", "island-chain": "岛", "seasonal-route": "路", "navigation-outpost": "灯",
      node: "地"
    })[kind] || "地";
  }

  function kindLabel(kind) {
    return ({
      faction: "主要势力", capital: "仙朝帝都", "undersea-capital": "海庭都城", "mobile-capital": "移动仙城", "island-capital-port": "群岛都港",
      city: "主要城池", "trade-metropolis": "商贸巨城", "craft-metropolis": "工造巨城", "caravan-city": "商旅城池",
      "faction-seat": "宗门驻地", port: "重要港口", "amphibious-port": "水陆港口", "transport-hub": "交通枢纽",
      "mountain-pass": "山川关隘", "treaty-seat": "盟约驻地", "civilian-heartland": "凡俗腹地", "river-corridor": "大河走廊",
      danger: "已知险地", "danger-zone": "已知险地", "resource-danger-zone": "资源险地", "anomaly-zone": "异常区域", "mobile-anomaly": "移动异境",
      ruin: "历史遗迹", "ruin-zone": "历史遗迹", resource: "资源区域", "resource-zone": "资源区域", "industrial-resource-zone": "工矿区域",
      "sea-route-gate": "航路门径", "sea-lane-hub": "航运枢纽", "island-chain": "海上群岛", "seasonal-route": "季节通路", "navigation-outpost": "导航哨站",
      region: "九域地理"
    })[kind] || "地图节点";
  }

  function accessLabel(access) {
    return ({ public: "公开地理", travel: "旅行地图", faction: "势力情报", "deep-secret": "深层秘密", "world-truth": "作者母版" })[access] || access;
  }

  function yearToChinese(year) {
    if (year === 1) return "元";
    const digits = "〇一二三四五六七八九";
    return String(year).split("").map((digit) => digits[Number(digit)]).join("");
  }

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  }
})();
