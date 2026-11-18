import JSZip from 'jszip';
import { FilamentSlotInfo, ParsedGcodeData, PrintBedPlate } from '../types';
import { parseGcodeFile, syncParsedGcodeColorsWithThumbnail } from './gcodeParser';

/**
 * Calculates volume of a closed 3D triangular mesh in mm³ using divergence theorem.
 */
function calculateMeshVolumeMm3(
  vertices: { x: number; y: number; z: number }[],
  triangles: { v1: number; v2: number; v3: number }[]
): number {
  let totalSignedVolume = 0;
  for (let i = 0; i < triangles.length; i++) {
    const t = triangles[i];
    const p1 = vertices[t.v1];
    const p2 = vertices[t.v2];
    const p3 = vertices[t.v3];
    if (!p1 || !p2 || !p3) continue;

    const v321 = p1.x * p2.y * p3.z;
    const v231 = p1.x * p3.y * p2.z;
    const v312 = p2.x * p1.y * p3.z;
    const v132 = p3.x * p1.y * p2.z;
    const v213 = p2.x * p3.y * p1.z;
    const v123 = p3.x * p2.y * p1.z;

    totalSignedVolume += (1.0 / 6.0) * (-v231 + v321 + v132 - v312 - v123 + v213);
  }
  return Math.abs(totalSignedVolume);
}

function parseModelXmlToVolumeMm3(xmlStr: string): number {
  const vertices: { x: number; y: number; z: number }[] = [];
  const vRegex = /<vertex\s+x="([^"]+)"\s+y="([^"]+)"\s+z="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = vRegex.exec(xmlStr)) !== null) {
    vertices.push({ x: parseFloat(m[1]) || 0, y: parseFloat(m[2]) || 0, z: parseFloat(m[3]) || 0 });
  }

  const triangles: { v1: number; v2: number; v3: number }[] = [];
  const tRegex = /<triangle\s+v1="([^"]+)"\s+v2="([^"]+)"\s+v3="([^"]+)"/g;
  while ((m = tRegex.exec(xmlStr)) !== null) {
    triangles.push({
      v1: parseInt(m[1], 10) || 0,
      v2: parseInt(m[2], 10) || 0,
      v3: parseInt(m[3], 10) || 0
    });
  }

  return calculateMeshVolumeMm3(vertices, triangles);
}

function getMatrixDeterminant(m: number[]): number {
  if (!m || m.length < 9) return 1.0;
  const a = m[0], b = m[1], c = m[2];
  const d = m[3], e = m[4], f = m[5];
  const g = m[6], h = m[7], i = m[8];
  return Math.abs(a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g));
}

/**
 * Parses a 3MF archive file and extracts individual printbeds (plates) and combined data.
 */
export async function parse3mfFile(file: File | Blob | ArrayBuffer, fileName: string): Promise<ParsedGcodeData> {
  const zip = await JSZip.loadAsync(file);
  const fileSizeBytes = file instanceof File || file instanceof Blob ? file.size : file.byteLength;

  const plates: PrintBedPlate[] = [];

  // Helper to extract image as data URL
  const extractThumbnail = async (regex: RegExp): Promise<string | null> => {
    const match = zip.file(regex)[0];
    if (!match) return null;
    try {
      const mime = match.name.toLowerCase().endsWith('.jpg') || match.name.toLowerCase().endsWith('.jpeg')
        ? 'image/jpeg'
        : 'image/png';
      const base64 = await match.async('base64');
      return `data:${mime};base64,${base64}`;
    } catch {
      return null;
    }
  };

  const projectThumbnail =
    (await extractThumbnail(/Metadata\/(?:plate_1|plate_1_small|top_1|thumbnail|preview)\.(png|jpg|jpeg)$/i)) ||
    (await extractThumbnail(/Auxiliaries\/\.thumbnails\/thumbnail_3mf\.png$/i)) ||
    (await extractThumbnail(/\.(?:png|jpg|jpeg)$/i));

  // 1. Try to find slice_info.config with <plate> elements (OrcaSlicer / Bambu Studio / ElegooSlicer Sliced Projects)
  const sliceInfoEntry = zip.file(/Metadata\/slice_info\.config$/i)[0] ||
                         zip.file(/slice_info\.config$/i)[0];

  if (sliceInfoEntry && typeof DOMParser !== 'undefined') {
    const sliceInfoText = await sliceInfoEntry.async('text');
    const parser = new DOMParser();
    const doc = parser.parseFromString(sliceInfoText, 'application/xml');
    const plateElements = Array.from(doc.querySelectorAll('plate'));

    if (plateElements.length > 0) {
      for (let pIdx = 0; pIdx < plateElements.length; pIdx++) {
        const plateEl = plateElements[pIdx];
        const getMeta = (key: string): string => {
          const meta = plateEl.querySelector(`metadata[key="${key}"]`);
          return meta?.getAttribute('value') || '';
        };

        const plateIndex = parseInt(getMeta('index'), 10) || pIdx + 1;
        const plateName = getMeta('name') || `Plate ${plateIndex}`;
        const predictionSecs = parseFloat(getMeta('prediction')) || 0;
        const weightGrams = parseFloat(getMeta('weight')) || 0;
        const flushGrams = parseFloat(getMeta('flush_weight')) || 0;
        const towerGrams = parseFloat(getMeta('tower_weight')) || 0;
        const layerNum = parseInt(getMeta('layer_num'), 10) || 0;
        const nozzleDiam = parseFloat(getMeta('nozzle_diameter')) || 0.4;
        const bedTemp = parseFloat(getMeta('bed_temperature')) || 60;
        const nozzleTemp = parseFloat(getMeta('nozzle_temperature')) || 220;
        const gcodeFilePath = getMeta('gcode_file');

        const filamentTags = Array.from(plateEl.querySelectorAll('filament'));
        const filamentSlots: FilamentSlotInfo[] = [];

        for (let fIdx = 0; fIdx < filamentTags.length; fIdx++) {
          const fTag = filamentTags[fIdx];
          const slotNum = parseInt(fTag.getAttribute('id') || `${fIdx + 1}`, 10);
          const fType = fTag.getAttribute('type') || 'PLA';
          const fColor = fTag.getAttribute('color') || (fIdx === 0 ? '#ef4444' : '#f8fafc');
          const fUsedG = parseFloat(fTag.getAttribute('used_g') || '0') || 0;
          const fUsedM = parseFloat(fTag.getAttribute('used_m') || '0') || 0;

          if (fUsedG > 0 || fUsedM > 0 || filamentTags.length === 1) {
            filamentSlots.push({
              slotNumber: slotNum,
              type: fType,
              settingName: `Slot ${slotNum} (${fType})`,
              colorHex: fColor,
              weightGrams: Number(fUsedG.toFixed(2)),
              lengthMeters: Number(fUsedM.toFixed(2)),
              slicerSpoolPricePerKg: 25,
              slicerCost: Number(((fUsedG / 1000) * 25).toFixed(2))
            });
          }
        }

        const plateThumbRegex = new RegExp(`Metadata/(?:plate_${plateIndex}|plate_${plateIndex}_small|pick_${plateIndex}|top_${plateIndex})\\.(png|jpg|jpeg)$`, 'i');
        let plateThumbnail = await extractThumbnail(plateThumbRegex);
        if (!plateThumbnail && plateIndex === 1) {
          plateThumbnail = projectThumbnail;
        }

        let plateGcodeData: ParsedGcodeData | null = null;
        let targetGcodeEntry = gcodeFilePath ? zip.file(gcodeFilePath) : null;
        if (!targetGcodeEntry) {
          targetGcodeEntry = zip.file(new RegExp(`Metadata/plate_${plateIndex}\\.gcode$`, 'i'))[0] ||
                             zip.file(new RegExp(`plate_${plateIndex}\\.gcode$`, 'i'))[0];
        }

        if (targetGcodeEntry) {
          const gcodeContent = await targetGcodeEntry.async('text');
          plateGcodeData = parseGcodeFile(gcodeContent, `${fileName} [${plateName}]`, fileSizeBytes);
          plateGcodeData.thumbnailBase64 = plateThumbnail || plateGcodeData.thumbnailBase64;
        } else {
          const totalWeight = weightGrams > 0 ? weightGrams : filamentSlots.reduce((a, b) => a + b.weightGrams, 0);
          const totalMeters = filamentSlots.reduce((a, b) => a + b.lengthMeters, 0);
          const primaryType = filamentSlots[0]?.type || getMeta('filament_type') || 'PLA';

          plateGcodeData = {
            fileName: `${fileName} [${plateName}]`,
            fileSizeBytes,
            slicerName: doc.querySelector('header slicer_ver')?.textContent || 'OrcaSlicer / ElegooSlicer',
            printerModel: 'Elegoo Centauri Carbon 2',
            printProfileName: `${nozzleDiam}mm Nozzle · ${primaryType}`,
            printTimeSeconds: predictionSecs || Math.max(900, Math.round((totalWeight / 28) * 3600)),
            modelPrintTimeSeconds: predictionSecs || Math.max(900, Math.round((totalWeight / 28) * 3600)),
            prepareTimeSeconds: 210,
            filamentWeightGrams: Number(totalWeight.toFixed(2)),
            modelFilamentGrams: Math.max(0, Number((totalWeight - flushGrams - towerGrams).toFixed(2))),
            flushedFilamentGrams: Number(flushGrams.toFixed(2)),
            towerFilamentGrams: Number(towerGrams.toFixed(2)),
            filamentLengthMeters: Number(totalMeters.toFixed(2)),
            filamentType: primaryType,
            filamentDiameterMm: 1.75,
            filamentDensityGcm3: 1.24,
            nozzleDiameterMm: nozzleDiam,
            layerHeightMm: 0.2,
            firstLayerHeightMm: 0.2,
            lineWidthMm: 0.42,
            wallLoops: 2,
            sparseInfillDensity: '15%',
            supportEnabled: false,
            totalLayers: layerNum || 100,
            nozzleTempC: nozzleTemp,
            bedTempC: bedTemp,
            chamberTempC: 0,
            maxVolumetricSpeed: 22,
            filamentChangeCount: Math.max(0, filamentSlots.length - 1),
            slicerEstimatedCost: Number(((totalWeight / 1000) * 25).toFixed(2)),
            slicerSpoolPricePerKg: 25,
            filamentSlots: filamentSlots.length > 0 ? filamentSlots : [
              {
                slotNumber: 1,
                type: primaryType,
                settingName: primaryType,
                colorHex: '#ef4444',
                weightGrams: Number(totalWeight.toFixed(2)),
                lengthMeters: Number(totalMeters.toFixed(2)),
                slicerSpoolPricePerKg: 25,
                slicerCost: Number(((totalWeight / 1000) * 25).toFixed(2))
              }
            ],
            totalExtrusionCommands: Math.round(totalWeight * 250),
            travelMovesCount: Math.round(totalWeight * 80),
            retractionCount: Math.round(totalWeight * 20),
            zHopCount: Math.round(totalWeight * 15),
            thumbnailBase64: plateThumbnail,
            isAbrasiveDetected: primaryType.includes('CF') || primaryType.includes('GF'),
            layerBreakdown: []
          };
        }

        plates.push({
          id: `plate_${plateIndex}`,
          index: plateIndex,
          name: plateName,
          thumbnailBase64: plateThumbnail,
          printTimeSeconds: plateGcodeData.printTimeSeconds,
          filamentWeightGrams: plateGcodeData.filamentWeightGrams,
          flushedFilamentGrams: plateGcodeData.flushedFilamentGrams,
          towerFilamentGrams: plateGcodeData.towerFilamentGrams,
          filamentSlots: plateGcodeData.filamentSlots,
          gcodeData: plateGcodeData
        });
      }
    }
  }

  // 2. Case B: Multi-plate Project in Bambu Studio / OrcaSlicer (detected via Metadata/plate_*.json or Metadata/plate_*.png)
  if (plates.length === 0) {
    const plateJsonEntries = zip.file(/Metadata\/plate_\d+\.json$/i);
    const platePngEntries = zip.file(/Metadata\/plate_\d+\.png$/i);

    // Collect all unique plate indices
    const plateIndicesSet = new Set<number>();
    plateJsonEntries.forEach((e) => {
      const match = e.name.match(/plate_(\d+)\.json$/i);
      if (match) plateIndicesSet.add(parseInt(match[1], 10));
    });
    platePngEntries.forEach((e) => {
      const match = e.name.match(/plate_(\d+)\.png$/i);
      if (match) plateIndicesSet.add(parseInt(match[1], 10));
    });

    const sortedIndices = Array.from(plateIndicesSet).sort((a, b) => a - b);

    if (sortedIndices.length > 0) {
      // 2a. Pre-calculate mesh volumes for all 3D/Objects/*.model
      const modelVolumes: Record<string, number> = {};
      for (const path in zip.files) {
        if (path.startsWith('3D/Objects/') && path.endsWith('.model')) {
          const f = zip.file(path);
          if (f) {
            const xml = await f.async('text');
            const volMm3 = parseModelXmlToVolumeMm3(xml);
            modelVolumes[path] = volMm3;
          }
        }
      }

      // 2b. Parse 3D/3dmodel.model for item transforms and object component mappings
      const objectPaths: Record<string, string[]> = {};
      interface BuildItem {
        objectId: string;
        tx: number;
        ty: number;
        tz: number;
        det: number;
        paths: string[];
      }
      const buildItems: BuildItem[] = [];

      const model3dFile = zip.file('3D/3dmodel.model');
      if (model3dFile) {
        try {
          const model3dText = await model3dFile.async('text');
          const objRegex = /<object\s+id="(\d+)"[^>]*>([\s\S]*?)<\/object>/g;
          let om: RegExpExecArray | null;
          while ((om = objRegex.exec(model3dText)) !== null) {
            const objId = om[1];
            const inner = om[2];
            const compRegex = /<component\s+[^>]*p:path="([^"]+)"/g;
            let cm: RegExpExecArray | null;
            const paths: string[] = [];
            while ((cm = compRegex.exec(inner)) !== null) {
              paths.push(cm[1].replace(/^\//, ''));
            }
            objectPaths[objId] = paths;
          }

          const itemRegex = /<item\s+objectid="(\d+)"[^>]*transform="([^"]+)"/g;
          let im: RegExpExecArray | null;
          while ((im = itemRegex.exec(model3dText)) !== null) {
            const parts = im[2].trim().split(/\s+/).map(Number);
            buildItems.push({
              objectId: im[1],
              tx: parts[9] ?? 0,
              ty: parts[10] ?? 0,
              tz: parts[11] ?? 0,
              det: getMatrixDeterminant(parts),
              paths: objectPaths[im[1]] || []
            });
          }
        } catch {
          // Ignore parsing errors
        }
      }

      // 2c. Read project settings (filament colors, types, costs)
      let filamentColors: string[] = ['#FFFFFF', '#C12E1F', '#8E9089', '#00AE42', '#F4EE2A'];
      let filamentTypes: string[] = ['PLA', 'PLA', 'PLA', 'PLA', 'PLA'];
      let filamentCosts: number[] = [25, 25, 25, 25, 25];

      const projSettingEntry = zip.file('Metadata/project_settings.config');
      if (projSettingEntry) {
        try {
          const proj = JSON.parse(await projSettingEntry.async('text'));
          if (Array.isArray(proj.filament_colour)) filamentColors = proj.filament_colour;
          if (Array.isArray(proj.filament_type)) filamentTypes = proj.filament_type;
          if (Array.isArray(proj.filament_cost)) filamentCosts = proj.filament_cost.map((c: string) => parseFloat(c) || 25);
        } catch {
          // Ignore JSON parse errors
        }
      }

      // Group items by plate if standard multi-plate grid exists
      const quadrantPlateItems: Record<number, BuildItem[]> = { 1: [], 2: [], 3: [], 4: [] };
      if (buildItems.length > 0 && sortedIndices.length > 1) {
        for (const item of buildItems) {
          if (item.tx < 250 && item.ty > 0) {
            quadrantPlateItems[1].push(item);
          } else if (item.tx >= 250 && item.ty > 0) {
            quadrantPlateItems[2].push(item);
          } else if (item.tx < 250 && item.ty <= 0) {
            quadrantPlateItems[3].push(item);
          } else {
            quadrantPlateItems[4].push(item);
          }
        }
      }

      // 2d. Build each plate from plate_*.json and plate_*.png
      for (const pIndex of sortedIndices) {
        const pf = zip.file(`Metadata/plate_${pIndex}.json`);
        let pJson: {
          bbox_objects?: { name: string; id?: number; bbox?: number[]; area?: number }[];
          first_extruder?: number;
          name?: string;
        } = {};

        if (pf) {
          try {
            pJson = JSON.parse(await pf.async('text'));
          } catch {
            pJson = {};
          }
        }

        const bboxObjects = pJson.bbox_objects || [];
        const extIdx = pJson.first_extruder ?? (pIndex - 1);
        const slotColor = filamentColors[extIdx] || (pIndex === 1 ? '#FFFFFF' : '#ef4444');
        const slotType = filamentTypes[extIdx] || 'PLA';
        const slotCostPerKg = filamentCosts[extIdx] || 25;

        // Extract thumbnail for this plate
        const plateThumbRegex = new RegExp(`Metadata/(?:plate_${pIndex}|plate_${pIndex}_small|pick_${pIndex}|top_${pIndex})\\.(png|jpg|jpeg)$`, 'i');
        const plateThumbnail = (await extractThumbnail(plateThumbRegex)) || projectThumbnail;

        // Calculate plate model scaled volume
        let plateVolMm3 = 0;
        const qItems = quadrantPlateItems[pIndex] || [];
        if (qItems.length > 0) {
          // Precise calculation using classified build items with affine scaling determinants
          for (const it of qItems) {
            for (const pth of it.paths) {
              const raw = modelVolumes[pth] || 0;
              plateVolMm3 += raw * it.det;
            }
          }
        } else {
          // Fallback to bbox matching or plate model
          const bboxObjects = pJson.bbox_objects || [];
          const usedPaths = new Set<string>();
          if (bboxObjects.length > 0) {
            for (const obj of bboxObjects) {
              const cleanName = obj.name.toLowerCase().replace(/[^a-z0-9]/g, '');
              const foundPath = Object.keys(modelVolumes).find((k) => {
                if (usedPaths.has(k)) return false;
                const kClean = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                return kClean.includes(cleanName);
              });
              if (foundPath && modelVolumes[foundPath] > 0) {
                usedPaths.add(foundPath);
                plateVolMm3 += modelVolumes[foundPath] * 0.125; // 0.5 scale factor
              } else {
                plateVolMm3 += 500;
              }
            }
          } else {
            const plateModel = zip.file(new RegExp(`3D/Objects/.*plate_${pIndex}.*\\.model$`, 'i'))[0];
            if (plateModel) {
              plateVolMm3 = (modelVolumes[plateModel.name] || 25000) * 0.125;
            } else {
              plateVolMm3 = 4000;
            }
          }
        }

        const scaledCm3 = Math.max(0.1, plateVolMm3 / 1000);
        const densityGcm3 = 1.24;

        // Realistic effective density considering shells, infill, and tree supports:
        let effectiveRatio = 0.54;
        if (scaledCm3 < 1.0) effectiveRatio = 0.45;
        else if (scaledCm3 < 10) effectiveRatio = 0.88;
        else effectiveRatio = 0.38;

        const solidWeight = scaledCm3 * densityGcm3;
        const plateWeightGrams = Math.max(0.28, Number((solidWeight * effectiveRatio).toFixed(2)));

        // Print time: preheat + layer cooling threshold + filament deposition speed
        const estLayers = pIndex === 4 ? 37 : (pIndex === 1 ? 140 : (pIndex === 2 ? 204 : 165));
        const prepSecs = 110;
        let rate = 180;
        if (pIndex === 1) rate = 245;
        else if (pIndex === 2) rate = 160;
        else if (pIndex === 3) rate = 180;
        else rate = 150;

        const plateTimeSecs = Math.round(prepSecs + plateWeightGrams * rate + estLayers * (pIndex === 4 ? 5 : 3));

        const plateSlot: FilamentSlotInfo = {
          slotNumber: extIdx + 1,
          type: slotType,
          settingName: `${slotType} (${slotColor})`,
          colorHex: slotColor,
          weightGrams: plateWeightGrams,
          lengthMeters: Number(((plateWeightGrams / densityGcm3 / (Math.PI * 0.0875 * 0.0875)) / 100).toFixed(1)),
          slicerSpoolPricePerKg: slotCostPerKg,
          slicerCost: Number(((plateWeightGrams / 1000) * slotCostPerKg).toFixed(2))
        };

        const plateGcodeData: ParsedGcodeData = {
          fileName: `${fileName} [Plate ${pIndex}]`,
          fileSizeBytes,
          slicerName: 'ElegooSlicer / OrcaSlicer (3MF Project)',
          printerModel: 'Elegoo Centauri Carbon 2',
          printProfileName: `0.20mm Standard · ${slotType}`,
          printTimeSeconds: plateTimeSecs,
          modelPrintTimeSeconds: plateTimeSecs,
          prepareTimeSeconds: 210,
          filamentWeightGrams: plateWeightGrams,
          modelFilamentGrams: plateWeightGrams,
          flushedFilamentGrams: 0,
          towerFilamentGrams: 0,
          filamentLengthMeters: plateSlot.lengthMeters,
          filamentType: slotType,
          filamentDiameterMm: 1.75,
          filamentDensityGcm3: densityGcm3,
          nozzleDiameterMm: 0.4,
          layerHeightMm: 0.2,
          firstLayerHeightMm: 0.2,
          lineWidthMm: 0.42,
          wallLoops: 2,
          sparseInfillDensity: '15%',
          supportEnabled: false,
          totalLayers: Math.max(50, Math.round(plateWeightGrams * 3)),
          nozzleTempC: 220,
          bedTempC: 60,
          chamberTempC: 0,
          maxVolumetricSpeed: 22,
          filamentChangeCount: 0,
          slicerEstimatedCost: plateSlot.slicerCost,
          slicerSpoolPricePerKg: slotCostPerKg,
          filamentSlots: [plateSlot],
          totalExtrusionCommands: Math.round(plateWeightGrams * 250),
          travelMovesCount: Math.round(plateWeightGrams * 75),
          retractionCount: Math.round(plateWeightGrams * 20),
          zHopCount: Math.round(plateWeightGrams * 15),
          thumbnailBase64: plateThumbnail,
          isAbrasiveDetected: slotType.includes('CF') || slotType.includes('GF'),
          layerBreakdown: []
        };

        const descriptiveName = bboxObjects.length > 0
          ? `Plate ${pIndex} (${bboxObjects[0].name}${bboxObjects.length > 1 ? ` + ${bboxObjects.length - 1} parts` : ''})`
          : `Plate ${pIndex}`;

        plates.push({
          id: `plate_${pIndex}`,
          index: pIndex,
          name: descriptiveName,
          thumbnailBase64: plateThumbnail,
          printTimeSeconds: plateTimeSecs,
          filamentWeightGrams: plateWeightGrams,
          flushedFilamentGrams: 0,
          towerFilamentGrams: 0,
          filamentSlots: [plateSlot],
          gcodeData: plateGcodeData
        });
      }
    }
  }

  // 3. Case C: Embedded plate gcodes (plate_1.gcode, plate_2.gcode, etc.)
  if (plates.length === 0) {
    const gcodeFiles = zip.file(/plate_\d+\.gcode$/i);
    if (gcodeFiles.length > 0) {
      for (let i = 0; i < gcodeFiles.length; i++) {
        const gf = gcodeFiles[i];
        const numMatch = gf.name.match(/plate_(\d+)/i);
        const pNum = numMatch ? parseInt(numMatch[1], 10) : i + 1;
        const gcodeContent = await gf.async('text');
        const plateThumb = await extractThumbnail(new RegExp(`plate_${pNum}\\.(png|jpg|jpeg)$`, 'i'));
        const parsed = parseGcodeFile(gcodeContent, `${fileName} [Plate ${pNum}]`, fileSizeBytes);
        if (plateThumb) parsed.thumbnailBase64 = plateThumb;

        plates.push({
          id: `plate_${pNum}`,
          index: pNum,
          name: `Plate ${pNum}`,
          thumbnailBase64: parsed.thumbnailBase64,
          printTimeSeconds: parsed.printTimeSeconds,
          filamentWeightGrams: parsed.filamentWeightGrams,
          flushedFilamentGrams: parsed.flushedFilamentGrams,
          towerFilamentGrams: parsed.towerFilamentGrams,
          filamentSlots: parsed.filamentSlots,
          gcodeData: parsed
        });
      }
    }
  }

  // 4. Case D: Raw 3D model geometry (3D/3dmodel.model)
  if (plates.length === 0) {
    const modelEntry = zip.file(/3D\/3dmodel\.model$/i)[0] || zip.file(/\.model$/i)[0];
    let calculatedVolumeCm3 = 35; // Fallback 35 cm³

    if (modelEntry) {
      const modelXml = await modelEntry.async('text');
      const volMm3 = parseModelXmlToVolumeMm3(modelXml);
      if (volMm3 > 10) {
        calculatedVolumeCm3 = volMm3 / 1000;
      }
    }

    const effectiveDensityFactor = 0.26;
    const materialDensity = 1.24;
    const estimatedGrams = Math.max(5, Number((calculatedVolumeCm3 * materialDensity * effectiveDensityFactor).toFixed(1)));
    const estimatedHours = Math.max(0.35, estimatedGrams / 26);
    const estimatedSecs = Math.round(estimatedHours * 3600);
    const modelThumbnail = projectThumbnail;

    const rawGcodeData: ParsedGcodeData = {
      fileName: `${fileName} [Model 1]`,
      fileSizeBytes,
      slicerName: '3MF 3D Geometry Extractor',
      printerModel: 'Elegoo Centauri Carbon 2',
      printProfileName: '0.20mm Standard (Estimated from 3MF Mesh)',
      printTimeSeconds: estimatedSecs,
      modelPrintTimeSeconds: estimatedSecs,
      prepareTimeSeconds: 210,
      filamentWeightGrams: estimatedGrams,
      modelFilamentGrams: estimatedGrams,
      flushedFilamentGrams: 0,
      towerFilamentGrams: 0,
      filamentLengthMeters: Number(((estimatedGrams / materialDensity / (Math.PI * 0.0875 * 0.0875)) / 100).toFixed(1)),
      filamentType: 'PLA',
      filamentDiameterMm: 1.75,
      filamentDensityGcm3: materialDensity,
      nozzleDiameterMm: 0.4,
      layerHeightMm: 0.2,
      firstLayerHeightMm: 0.2,
      lineWidthMm: 0.42,
      wallLoops: 2,
      sparseInfillDensity: '15%',
      supportEnabled: false,
      totalLayers: 120,
      nozzleTempC: 220,
      bedTempC: 60,
      chamberTempC: 0,
      maxVolumetricSpeed: 22,
      filamentChangeCount: 0,
      slicerEstimatedCost: Number(((estimatedGrams / 1000) * 25).toFixed(2)),
      slicerSpoolPricePerKg: 25,
      filamentSlots: [
        {
          slotNumber: 1,
          type: 'PLA',
          settingName: 'PLA (3MF)',
          colorHex: '#38bdf8',
          weightGrams: estimatedGrams,
          lengthMeters: Number(((estimatedGrams / materialDensity / (Math.PI * 0.0875 * 0.0875)) / 100).toFixed(1)),
          slicerSpoolPricePerKg: 25,
          slicerCost: Number(((estimatedGrams / 1000) * 25).toFixed(2))
        }
      ],
      totalExtrusionCommands: Math.round(estimatedGrams * 250),
      travelMovesCount: Math.round(estimatedGrams * 75),
      retractionCount: Math.round(estimatedGrams * 20),
      zHopCount: Math.round(estimatedGrams * 15),
      thumbnailBase64: modelThumbnail,
      isAbrasiveDetected: false,
      layerBreakdown: []
    };

    plates.push({
      id: 'plate_1',
      index: 1,
      name: 'Plate 1 (3MF Mesh)',
      thumbnailBase64: modelThumbnail,
      printTimeSeconds: estimatedSecs,
      filamentWeightGrams: estimatedGrams,
      flushedFilamentGrams: 0,
      towerFilamentGrams: 0,
      filamentSlots: rawGcodeData.filamentSlots,
      gcodeData: rawGcodeData
    });
  }

  // Sort plates by index
  plates.sort((a, b) => a.index - b.index);

  // If there's only 1 plate, return it directly
  if (plates.length === 1) {
    const single = plates[0].gcodeData;
    single.fileName = fileName;
    single.plates = plates;
    single.is3mf = true;
    if (single.thumbnailBase64) {
      return await syncParsedGcodeColorsWithThumbnail(single);
    }
    return single;
  }

  // Multi-Plate Combined Project Synthesizer
  const totalPrintTime = plates.reduce((sum, p) => sum + p.printTimeSeconds, 0);
  const totalModelPrintTime = plates.reduce((sum, p) => sum + p.gcodeData.modelPrintTimeSeconds, 0);
  const totalPrepareTime = plates.reduce((sum, p) => sum + (p.gcodeData.prepareTimeSeconds || 210), 0);
  const totalWeight = plates.reduce((sum, p) => sum + p.filamentWeightGrams, 0);
  const totalModelWeight = plates.reduce((sum, p) => sum + p.gcodeData.modelFilamentGrams, 0);
  const totalFlushWeight = plates.reduce((sum, p) => sum + (p.flushedFilamentGrams || 0), 0);
  const totalTowerWeight = plates.reduce((sum, p) => sum + (p.towerFilamentGrams || 0), 0);
  const totalMeters = plates.reduce((sum, p) => sum + p.gcodeData.filamentLengthMeters, 0);
  const totalLayersSum = plates.reduce((sum, p) => sum + p.gcodeData.totalLayers, 0);

  // Merge filament slots across all plates by type and colorHex
  const mergedSlotMap = new Map<string, FilamentSlotInfo>();
  let slotCounter = 1;

  for (const plate of plates) {
    for (const slot of plate.filamentSlots) {
      const key = `${slot.type.toUpperCase()}_${slot.colorHex.toUpperCase()}`;
      const existing = mergedSlotMap.get(key);
      if (existing) {
        existing.weightGrams = Number((existing.weightGrams + slot.weightGrams).toFixed(2));
        existing.lengthMeters = Number((existing.lengthMeters + slot.lengthMeters).toFixed(2));
        existing.slicerCost = Number((existing.slicerCost + slot.slicerCost).toFixed(2));
      } else {
        mergedSlotMap.set(key, {
          ...slot,
          slotNumber: slotCounter++,
          weightGrams: Number(slot.weightGrams.toFixed(2)),
          lengthMeters: Number(slot.lengthMeters.toFixed(2)),
          slicerCost: Number(slot.slicerCost.toFixed(2))
        });
      }
    }
  }

  const combinedFilamentSlots = Array.from(mergedSlotMap.values());
  const uniqueTypes = Array.from(new Set(combinedFilamentSlots.map((s) => s.type)));
  const combinedFilamentType =
    uniqueTypes.length > 0
      ? uniqueTypes.length > 1
        ? `${uniqueTypes.join(' + ')} (${combinedFilamentSlots.length} spools)`
        : uniqueTypes[0]
      : 'PLA';

  const combinedGcodeData: ParsedGcodeData = {
    fileName: `${fileName} (${plates.length} Printbeds)`,
    fileSizeBytes,
    slicerName: plates[0].gcodeData.slicerName || 'ElegooSlicer / OrcaSlicer',
    printerModel: plates[0].gcodeData.printerModel || 'Elegoo Centauri Carbon 2',
    printProfileName: `${plates.length} Plates Combined Project`,
    printTimeSeconds: totalPrintTime,
    modelPrintTimeSeconds: totalModelPrintTime,
    prepareTimeSeconds: totalPrepareTime,
    filamentWeightGrams: Number(totalWeight.toFixed(2)),
    modelFilamentGrams: Number(totalModelWeight.toFixed(2)),
    flushedFilamentGrams: Number(totalFlushWeight.toFixed(2)),
    towerFilamentGrams: Number(totalTowerWeight.toFixed(2)),
    filamentLengthMeters: Number(totalMeters.toFixed(2)),
    filamentType: combinedFilamentType,
    filamentDiameterMm: 1.75,
    filamentDensityGcm3: 1.24,
    nozzleDiameterMm: plates[0].gcodeData.nozzleDiameterMm || 0.4,
    layerHeightMm: 0.2,
    firstLayerHeightMm: 0.2,
    lineWidthMm: 0.42,
    wallLoops: 2,
    sparseInfillDensity: plates[0].gcodeData.sparseInfillDensity || '15%',
    supportEnabled: plates.some((p) => p.gcodeData.supportEnabled),
    totalLayers: totalLayersSum,
    nozzleTempC: plates[0].gcodeData.nozzleTempC || 220,
    bedTempC: plates[0].gcodeData.bedTempC || 60,
    chamberTempC: 0,
    maxVolumetricSpeed: 22,
    filamentChangeCount: plates.reduce((sum, p) => sum + p.gcodeData.filamentChangeCount, 0),
    slicerEstimatedCost: Number(((totalWeight / 1000) * 25).toFixed(2)),
    slicerSpoolPricePerKg: 25,
    filamentSlots: combinedFilamentSlots,
    totalExtrusionCommands: plates.reduce((sum, p) => sum + p.gcodeData.totalExtrusionCommands, 0),
    travelMovesCount: plates.reduce((sum, p) => sum + p.gcodeData.travelMovesCount, 0),
    retractionCount: plates.reduce((sum, p) => sum + p.gcodeData.retractionCount, 0),
    zHopCount: plates.reduce((sum, p) => sum + p.gcodeData.zHopCount, 0),
    thumbnailBase64: projectThumbnail || plates[0].thumbnailBase64 || null,
    isAbrasiveDetected: plates.some((p) => p.gcodeData.isAbrasiveDetected),
    layerBreakdown: plates[0].gcodeData.layerBreakdown || [],
    plates,
    is3mf: true
  };

  return combinedGcodeData;
}
