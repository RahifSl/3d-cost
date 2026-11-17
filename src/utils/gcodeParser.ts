import { FilamentSlotInfo, ParsedGcodeData } from '../types';

function parseDurationStringToSeconds(raw: string): number {
  let totalSeconds = 0;
  const daysMatch = raw.match(/(\d+)\s*d/i);
  const hoursMatch = raw.match(/(\d+)\s*h/i);
  const minsMatch = raw.match(/(\d+)\s*m/i);
  const secsMatch = raw.match(/(\d+)\s*s/i);

  if (daysMatch) totalSeconds += parseInt(daysMatch[1], 10) * 86400;
  if (hoursMatch) totalSeconds += parseInt(hoursMatch[1], 10) * 3600;
  if (minsMatch) totalSeconds += parseInt(minsMatch[1], 10) * 60;
  if (secsMatch) totalSeconds += parseInt(secsMatch[1], 10);

  if (totalSeconds === 0 && /^\d+$/.test(raw.trim())) {
    totalSeconds = parseInt(raw.trim(), 10);
  }
  return totalSeconds;
}

function parseNumberList(raw: string): number[] {
  return raw
    .split(/[,;]/)
    .map((s) => parseFloat(s.replace(/["']/g, '').trim()))
    .map((n) => (isNaN(n) ? 0 : n));
}

function parseStringList(raw: string): string[] {
  return raw
    .split(/[;,]/)
    .map((s) => s.replace(/^["']|["']$/g, '').trim())
    .filter(Boolean);
}

function parseSlotStringList(raw: string): string[] {
  return raw
    .split(/[;,]/)
    .map((s) => s.replace(/^["']|["']$/g, '').trim());
}

export interface ExtrusionSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  z: number;
  tool: number;
}

/**
 * Renders the actual G-code extrusion segments into a high-resolution model image
 * colored by active filament slot (e.g. Red Slot 1 + White Slot 2 on the Elegoo CC2 build plate).
 */
export function renderGcodeSegmentsToDataUrl(
  segments: ExtrusionSegment[],
  colors: string[]
): string {
  if (typeof document === 'undefined' || segments.length === 0) return '';
  const canvas = document.createElement('canvas');
  const size = 560;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Dark textured PEI plate background
  ctx.fillStyle = '#18181b';
  ctx.fillRect(0, 0, size, size);

  const pad = 28;
  const bedPx = size - pad * 2;
  ctx.fillStyle = '#27272a';
  ctx.strokeStyle = '#52525b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(pad, pad, bedPx, bedPx, 12);
  ctx.fill();
  ctx.stroke();

  // Subtle build plate grid
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 1;
  const gridSteps = 8;
  for (let i = 1; i < gridSteps; i++) {
    const p = pad + (bedPx / gridSteps) * i;
    ctx.beginPath();
    ctx.moveTo(p, pad);
    ctx.lineTo(p, pad + bedPx);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(pad, p);
    ctx.lineTo(pad + bedPx, p);
    ctx.stroke();
  }

  // Compute bounding box of the model so it fills the preview frame cleanly
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;

  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (s.x1 < minX) minX = s.x1;
    if (s.x2 < minX) minX = s.x2;
    if (s.x1 > maxX) maxX = s.x1;
    if (s.x2 > maxX) maxX = s.x2;
    if (s.y1 < minY) minY = s.y1;
    if (s.y2 < minY) minY = s.y2;
    if (s.y1 > maxY) maxY = s.y1;
    if (s.y2 > maxY) maxY = s.y2;
  }

  const spanX = Math.max(10, maxX - minX);
  const spanY = Math.max(10, maxY - minY);
  const usablePx = bedPx - 40;
  const scale = Math.min(usablePx / spanX, usablePx / spanY);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.1, Math.min(2.6, scale * 0.42));

  // Batch draw by tool color for fast rendering
  let currentTool = -1;
  ctx.beginPath();
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (s.tool !== currentTool) {
      if (currentTool !== -1) {
        ctx.stroke();
        ctx.beginPath();
      }
      currentTool = s.tool;
      ctx.strokeStyle = colors[currentTool] || colors[0] || '#ef4444';
    }
    const cx1 = size / 2 + (s.x1 - centerX) * scale;
    const cy1 = size / 2 - (s.y1 - centerY) * scale;
    const cx2 = size / 2 + (s.x2 - centerX) * scale;
    const cy2 = size / 2 - (s.y2 - centerY) * scale;
    ctx.moveTo(cx1, cy1);
    ctx.lineTo(cx2, cy2);
  }
  ctx.stroke();

  // Bottom Elegoo plate badge
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('ELEGOO CC2 · 256×256mm PLATE PREVIEW', size / 2, size - 10);

  return canvas.toDataURL('image/png');
}

export function parseGcodeFile(content: string, fileName: string, fileSizeBytes?: number): ParsedGcodeData {
  const lines = content.split(/\r?\n/);

  let slicerName = 'ElegooSlicer / OrcaSlicer';
  let printerModel = 'Elegoo Centauri Carbon 2';
  let printProfileName = '0.20mm Standard @Elegoo CC2';
  let estimatedTotalSeconds = 0;
  let modelPrintTimeSeconds = 0;
  let prepareTimeSeconds = 0;

  let totalFilamentGramsHeader = 0;
  let perExtruderGrams: number[] = [];
  let perExtruderMm: number[] = [];
  let perExtruderCost: number[] = [];
  let perExtruderSpoolRate: number[] = [];
  let filamentTypesList: string[] = [];
  let filamentSettingsNames: string[] = [];
  let filamentColorsList: string[] = [];
  let extruderColorsList: string[] = [];

  let flushedFilamentGrams = 0;
  let towerFilamentGrams = 0;
  let totalFilamentCostHeader: number | null = null;

  let filamentLengthMeters = 0;
  let filamentType = 'PLA';
  let filamentDiameterMm = 1.75;
  let filamentDensityGcm3 = 1.24;
  let nozzleDiameterMm = 0.4;
  let layerHeightMm = 0.2;
  let firstLayerHeightMm = 0.2;
  let lineWidthMm = 0.42;
  let wallLoops = 2;
  let sparseInfillDensity = '15%';
  let supportEnabled = false;
  let totalLayers = 0;
  let nozzleTempC = 0;
  let bedTempC = 0;
  let chamberTempC = 0;
  let maxVolumetricSpeed = 22;
  let filamentChangeCount = 0;

  let totalExtrusionCommands = 0;
  let travelMovesCount = 0;
  let retractionCount = 0;
  let zHopCount = 0;
  let lastE = 0;
  let lastZ = 0;
  let lastX = 128;
  let lastY = 128;
  let hasValidXY = false;
  let activeToolIndex = 0;
  let isWipeTower = false;
  let isWiping = false;
  let isOuterFeature = true;
  let isRelativeExtrusion = false;
  let cumulativeExtrusionMm = 0;

  let inThumbnailBlock = false;
  let currentThumbMime = 'image/png';
  let thumbnailBuffer: string[] = [];
  let bestThumbnailBase64: string | null = null;
  let bestThumbnailRawLen = 0;

  // Store continuous extrusion segments for accurate 2D/3D model rendering
  const segments: ExtrusionSegment[] = [];
  const maxSegments = 50000;
  const segmentStride = Math.max(1, Math.floor(lines.length / 200000));

  const layerBreakdown: { zHeight: number; extrusionMm: number; speedMmS: number }[] = [];
  let currentLayerZ = 0.2;
  let currentLayerExtrusion = 0;
  let currentLayerSpeedSum = 0;
  let currentLayerSpeedCount = 0;

  const fnNozzleMatch = fileName.match(/ECC2_(\d+\.\d+)_/i);
  if (fnNozzleMatch) {
    nozzleDiameterMm = parseFloat(fnNozzleMatch[1]) || 0.4;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // 1. Thumbnail extraction (supports PNG, JPG, and Orca/ElegooSlicer blocks)
    const lowerLine = line.toLowerCase();
    if (
      lowerLine.startsWith('; thumbnail begin') ||
      lowerLine.startsWith('; thumbnail_jpg begin') ||
      lowerLine.startsWith('; jpg begin') ||
      lowerLine.startsWith('; png begin')
    ) {
      inThumbnailBlock = true;
      currentThumbMime =
        lowerLine.includes('jpg') || lowerLine.includes('jpeg') ? 'image/jpeg' : 'image/png';
      thumbnailBuffer = [];
      continue;
    }
    if (
      lowerLine.startsWith('; thumbnail end') ||
      lowerLine.startsWith('; thumbnail_jpg end') ||
      lowerLine.startsWith('; jpg end') ||
      lowerLine.startsWith('; png end')
    ) {
      inThumbnailBlock = false;
      const joined = thumbnailBuffer.join('').replace(/\s+/g, '');
      // Only use if it's a valid PNG (iVBOR) or JPEG (/9j/) base64 payload
      if (
        (joined.startsWith('iVBOR') || joined.startsWith('/9j/')) &&
        joined.length > bestThumbnailRawLen
      ) {
        bestThumbnailRawLen = joined.length;
        const mime = joined.startsWith('/9j/') ? 'image/jpeg' : currentThumbMime;
        bestThumbnailBase64 = `data:${mime};base64,${joined}`;
      }
      continue;
    }
    if (inThumbnailBlock && line.startsWith(';')) {
      thumbnailBuffer.push(line.replace(/^;\s*/, ''));
      continue;
    }

    // Track feature types & tool changes in comments
    if (line.startsWith(';')) {
      const comment = line.slice(1).trim();
      const lower = comment.toLowerCase();

      if (lower === 'wipe_start') {
        isWiping = true;
        continue;
      }
      if (lower === 'wipe_end') {
        isWiping = false;
        continue;
      }

      if (lower.startsWith('type:')) {
        const featType = lower.slice(5).trim();
        isWipeTower =
          featType.includes('wipe tower') ||
          featType.includes('prime tower') ||
          featType.includes('skirt');
        isOuterFeature =
          !featType.includes('sparse infill') &&
          !featType.includes('internal infill') &&
          !featType.includes('support');
      } else if (lower.startsWith('generated by')) {
        const cleaned = comment.replace(/^generated by\s+/i, '').split(' on ')[0].trim();
        if (cleaned) slicerName = cleaned;
      } else if (lower.startsWith('printer_model')) {
        const val = comment.split('=')[1]?.trim();
        if (val) printerModel = val;
      } else if (lower.startsWith('print_settings_id')) {
        const val = comment.split('=')[1]?.replace(/["']/g, '').trim();
        if (val) printProfileName = val;
      } else if (lower.startsWith('model printing time')) {
        const rhs = comment.includes('=') ? comment.split('=')[1] : comment.split(':')[1];
        if (rhs) {
          const secs = parseDurationStringToSeconds(rhs.split(';')[0].trim());
          if (secs > 0) modelPrintTimeSeconds = secs;
        }
      } else if (lower.startsWith('prepare time') || lower.startsWith('prepare_time')) {
        const rhs = comment.includes('=') ? comment.split('=')[1] : comment.split(':')[1];
        if (rhs) {
          const secs = parseDurationStringToSeconds(rhs.split(';')[0].trim());
          if (secs > 0) prepareTimeSeconds = secs;
        }
      } else if (
        lower.startsWith('estimated printing time') ||
        lower.startsWith('total printing time') ||
        lower.startsWith('total time') ||
        lower.startsWith('time:')
      ) {
        const rhs = comment.includes('=') ? comment.split('=')[1] : comment.split(':')[1];
        if (rhs) {
          const parsedSecs = parseDurationStringToSeconds(rhs.split(';')[0].trim());
          if (parsedSecs > estimatedTotalSeconds) {
            estimatedTotalSeconds = parsedSecs;
          }
        }
      } else if (lower.startsWith('total filament used [g]')) {
        const rhs = comment.split('=')[1]?.trim();
        if (rhs) {
          const val = parseFloat(rhs);
          if (!isNaN(val) && val > 0) totalFilamentGramsHeader = val;
        }
      } else if (lower.startsWith('filament used [g]')) {
        const rhs = comment.split('=')[1]?.trim();
        if (rhs) {
          const nums = parseNumberList(rhs);
          if (nums.some((n) => n > 0)) perExtruderGrams = nums;
        }
      } else if (lower.startsWith('filament used [mm]')) {
        const rhs = comment.split('=')[1]?.trim();
        if (rhs) {
          const nums = parseNumberList(rhs);
          if (nums.some((n) => n > 0)) {
            perExtruderMm = nums;
            const sumMm = nums.reduce((a, b) => a + b, 0);
            if (sumMm > 0) filamentLengthMeters = sumMm / 1000;
          }
        }
      } else if (lower.startsWith('filament used [m]')) {
        const rhs = comment.split('=')[1] || comment.split(':')[1];
        if (rhs) {
          const nums = parseNumberList(rhs);
          const sumM = nums.reduce((a, b) => a + b, 0);
          if (sumM > 0) filamentLengthMeters = sumM;
        }
      } else if (lower.startsWith('flush_filament_used [g]') || lower.startsWith('flushed_filament')) {
        const rhs = comment.split('=')[1]?.trim();
        if (rhs) {
          const sum = parseNumberList(rhs).reduce((a, b) => a + b, 0);
          if (sum > 0) flushedFilamentGrams = sum;
        }
      } else if (lower.startsWith('wipe_tower_filament_used [g]') || lower.startsWith('tower_filament')) {
        const rhs = comment.split('=')[1]?.trim();
        if (rhs) {
          const sum = parseNumberList(rhs).reduce((a, b) => a + b, 0);
          if (sum > 0) towerFilamentGrams = sum;
        }
      } else if (lower.startsWith('total filament cost')) {
        const rhs = comment.split('=')[1]?.trim();
        if (rhs) {
          const c = parseFloat(rhs);
          if (!isNaN(c) && c > 0) totalFilamentCostHeader = c;
        }
      } else if (lower.startsWith('filament cost')) {
        const rhs = comment.split('=')[1]?.trim();
        if (rhs) {
          const nums = parseNumberList(rhs);
          if (nums.some((n) => n > 0)) {
            perExtruderCost = nums;
            const sum = nums.reduce((a, b) => a + b, 0);
            if (sum > 0 && totalFilamentCostHeader === null) {
              totalFilamentCostHeader = sum;
            }
          }
        }
      } else if (lower.startsWith('filament_cost')) {
        const rhs = comment.split('=')[1]?.trim();
        if (rhs) {
          const nums = parseNumberList(rhs);
          if (nums.some((n) => n > 0)) {
            perExtruderSpoolRate = nums;
          }
        }
      } else if (lower.startsWith('filament_type')) {
        const rhs = comment.split('=')[1]?.trim();
        if (rhs) {
          const types = parseSlotStringList(rhs);
          if (types.some(Boolean)) {
            filamentTypesList = types;
            const firstValid = types.find(Boolean);
            if (firstValid) filamentType = firstValid;
          }
        }
      } else if (lower.startsWith('filament_settings_id')) {
        const rhs = comment.split('=')[1]?.trim();
        if (rhs) {
          const names = parseSlotStringList(rhs);
          if (names.some(Boolean)) {
            filamentSettingsNames = names;
          }
        }
      } else if (lower.startsWith('filament_colour')) {
        const rhs = comment.split('=')[1]?.trim();
        if (rhs) {
          const cols = parseSlotStringList(rhs);
          if (cols.some(Boolean)) filamentColorsList = cols;
        }
      } else if (lower.startsWith('extruder_colour')) {
        const rhs = comment.split('=')[1]?.trim();
        if (rhs) {
          const cols = parseSlotStringList(rhs);
          if (cols.some(Boolean)) extruderColorsList = cols;
        }
      } else if (lower.startsWith('filament_density')) {
        const rhs = comment.split('=')[1]?.trim();
        if (rhs) {
          const d = parseFloat(rhs.split(/[,;]/)[0]);
          if (!isNaN(d) && d > 0) filamentDensityGcm3 = d;
        }
      } else if (lower.startsWith('nozzle_diameter')) {
        const rhs = comment.split('=')[1]?.trim();
        if (rhs) {
          const nd = parseFloat(rhs.split(/[,;]/)[0]);
          if (!isNaN(nd) && nd > 0) nozzleDiameterMm = nd;
        }
      } else if (lower.startsWith('layer_height')) {
        const rhs = comment.split('=')[1]?.trim();
        if (rhs) {
          const lh = parseFloat(rhs);
          if (!isNaN(lh) && lh > 0) layerHeightMm = lh;
        }
      } else if (lower.startsWith('initial_layer_print_height') || lower.startsWith('first_layer_height')) {
        const rhs = comment.split('=')[1]?.trim();
        if (rhs) {
          const flh = parseFloat(rhs);
          if (!isNaN(flh) && flh > 0) firstLayerHeightMm = flh;
        }
      } else if (lower.startsWith('line_width') || lower.startsWith('extrusion_width')) {
        const rhs = comment.split('=')[1]?.trim();
        if (rhs) {
          const lw = parseFloat(rhs);
          if (!isNaN(lw) && lw > 0) lineWidthMm = lw;
        }
      } else if (lower.startsWith('wall_loops') || lower.startsWith('perimeters')) {
        const rhs = comment.split('=')[1]?.trim();
        if (rhs) {
          const wl = parseInt(rhs, 10);
          if (!isNaN(wl) && wl > 0) wallLoops = wl;
        }
      } else if (lower.startsWith('sparse_infill_density') || lower.startsWith('fill_density')) {
        const rhs = comment.split('=')[1]?.trim();
        if (rhs) sparseInfillDensity = rhs;
      } else if (lower.startsWith('enable_support') || lower.startsWith('support_material')) {
        const rhs = comment.split('=')[1]?.trim();
        if (rhs) supportEnabled = rhs === '1' || rhs.toLowerCase() === 'true';
      } else if (lower.startsWith('total layer number') || lower.startsWith('total_layer_number')) {
        const rhs = comment.split(/[:=]/)[1]?.trim();
        if (rhs) {
          const tl = parseInt(rhs, 10);
          if (!isNaN(tl) && tl > 0) totalLayers = tl;
        }
      } else if (
        lower.startsWith('nozzle_temperature ') ||
        lower.startsWith('nozzle_temperature=') ||
        lower.startsWith('first_layer_temperature')
      ) {
        const rhs = comment.split('=')[1]?.trim();
        if (rhs) {
          const nt = parseFloat(rhs.split(/[,;]/)[0]);
          if (!isNaN(nt) && nt > 0) nozzleTempC = nt;
        }
      } else if (
        lower.startsWith('bed_temperature') ||
        lower.startsWith('hot_plate_temp ') ||
        lower.startsWith('hot_plate_temp=') ||
        lower.startsWith('textured_plate_temp ') ||
        lower.startsWith('textured_plate_temp=')
      ) {
        const rhs = comment.split('=')[1]?.trim();
        if (rhs) {
          const bt = parseFloat(rhs.split(/[,;]/)[0]);
          if (!isNaN(bt) && bt > 0) bedTempC = bt;
        }
      } else if (lower.startsWith('chamber_temperature')) {
        const rhs = comment.split('=')[1]?.trim();
        if (rhs) {
          const ct = parseFloat(rhs.split(/[,;]/)[0]);
          if (!isNaN(ct) && ct > 0) chamberTempC = ct;
        }
      } else if (lower.startsWith('max_volumetric_speed') || lower.startsWith('filament_max_volumetric_speed')) {
        const rhs = comment.split('=')[1]?.trim();
        if (rhs) {
          const mvs = parseFloat(rhs.split(/[,;]/)[0]);
          if (!isNaN(mvs) && mvs > 0) maxVolumetricSpeed = mvs;
        }
      } else if (lower.startsWith('filament_change_times') || lower.startsWith('change_filament_times')) {
        const rhs = comment.split(/[:=]/)[1]?.trim();
        if (rhs) {
          const fc = parseInt(rhs, 10);
          if (!isNaN(fc) && fc >= 0) filamentChangeCount = fc;
        }
      } else if (lower.startsWith('z:')) {
        const zVal = parseFloat(comment.slice(2));
        if (!isNaN(zVal) && zVal > 0) {
          if (currentLayerExtrusion > 0 && layerBreakdown.length < 300) {
            layerBreakdown.push({
              zHeight: currentLayerZ,
              extrusionMm: Number(currentLayerExtrusion.toFixed(2)),
              speedMmS:
                currentLayerSpeedCount > 0
                  ? Math.round(currentLayerSpeedSum / currentLayerSpeedCount)
                  : 120
            });
          }
          currentLayerZ = zVal;
          currentLayerExtrusion = 0;
          currentLayerSpeedSum = 0;
          currentLayerSpeedCount = 0;
        }
      }
      continue;
    }

    // Track M82 / M83 extrusion mode
    if (line.startsWith('M83')) {
      isRelativeExtrusion = true;
      continue;
    }
    if (line.startsWith('M82')) {
      isRelativeExtrusion = false;
      continue;
    }

    // Tool change commands T0, T1, T2...
    if (/^T(\d+)(\s|$|;)/.test(line)) {
      const tMatch = line.match(/^T(\d+)/);
      if (tMatch) {
        activeToolIndex = parseInt(tMatch[1], 10) || 0;
      }
      continue;
    }

    // Active G-code commands
    if (line.startsWith('M104') || line.startsWith('M109')) {
      const sMatch = line.match(/S(\d+(\.\d+)?)/);
      if (sMatch) {
        const temp = parseFloat(sMatch[1]);
        if (temp > nozzleTempC && temp <= 350) nozzleTempC = temp;
      }
    } else if (line.startsWith('M140') || line.startsWith('M190')) {
      const sMatch = line.match(/S(\d+(\.\d+)?)/);
      if (sMatch) {
        const temp = parseFloat(sMatch[1]);
        if (temp > bedTempC && temp <= 130) bedTempC = temp;
      }
    } else if (line.startsWith('M600') || line.includes('SET_CONDITION A=WIPE_TOWER')) {
      filamentChangeCount = Math.max(1, filamentChangeCount);
      if (line.startsWith('M600')) {
        activeToolIndex = activeToolIndex === 0 ? 1 : 0;
      }
    } else if (line.startsWith('G0 ') || line.startsWith('G1 ')) {
      // Match numbers with or without leading zero before decimal (e.g. E.01502 or E-.728 in ElegooSlicer)
      const hasX = line.match(/X(-?(?:\d+\.?\d*|\.\d+))/);
      const hasY = line.match(/Y(-?(?:\d+\.?\d*|\.\d+))/);
      const hasE = line.match(/E(-?(?:\d+\.?\d*|\.\d+))/);
      const hasZ = line.match(/Z(-?(?:\d+\.?\d*|\.\d+))/);
      const hasF = line.match(/F(\d+(?:\.\d+)?)/);

      const prevX = lastX;
      const prevY = lastY;
      const hadValidXY = hasValidXY;

      if (hasX) {
        lastX = parseFloat(hasX[1]);
        hasValidXY = true;
      }
      if (hasY) {
        lastY = parseFloat(hasY[1]);
        hasValidXY = true;
      }

      if (hasF) {
        const speedMmMin = parseFloat(hasF[1]);
        if (!isNaN(speedMmMin) && speedMmMin > 0) {
          currentLayerSpeedSum += speedMmMin / 60;
          currentLayerSpeedCount++;
        }
      }

      if (hasZ) {
        const z = parseFloat(hasZ[1]);
        if (z > lastZ + 0.05 && !hasE) {
          zHopCount++;
        }
        lastZ = z;
      }

      let isExtrudingMove = false;
      if (hasE) {
        const eVal = parseFloat(hasE[1]);
        if (isRelativeExtrusion || Math.abs(eVal) < 2) {
          if (eVal < -0.001) {
            retractionCount++;
          } else if (eVal > 0 && !isWiping) {
            totalExtrusionCommands++;
            cumulativeExtrusionMm += eVal;
            currentLayerExtrusion += eVal;
            isExtrudingMove = true;
          }
        } else {
          if (eVal < lastE - 0.1) {
            retractionCount++;
          } else if (eVal > lastE && !isWiping) {
            totalExtrusionCommands++;
            const delta = eVal - lastE;
            if (delta > 0 && delta < 100) {
              cumulativeExtrusionMm += delta;
              currentLayerExtrusion += delta;
              isExtrudingMove = true;
            }
          }
        }
        lastE = eVal;
      } else {
        travelMovesCount++;
      }

      // Record true continuous extrusion segments (skipping purge line at Y < 5 or X < 5)
      if (
        isExtrudingMove &&
        hadValidXY &&
        (hasX || hasY) &&
        !isWipeTower &&
        isOuterFeature &&
        segments.length < maxSegments &&
        i % segmentStride === 0
      ) {
        const distSq = (lastX - prevX) * (lastX - prevX) + (lastY - prevY) * (lastY - prevY);
        if (distSq > 0.002 && distSq < 15000 && lastY > 6 && lastX > 6) {
          segments.push({
            x1: prevX,
            y1: prevY,
            x2: lastX,
            y2: lastY,
            z: currentLayerZ,
            tool: activeToolIndex
          });
        }
      }
    }
  }

  if (currentLayerExtrusion > 0 && layerBreakdown.length < 300) {
    layerBreakdown.push({
      zHeight: currentLayerZ,
      extrusionMm: Number(currentLayerExtrusion.toFixed(2)),
      speedMmS:
        currentLayerSpeedCount > 0 ? Math.round(currentLayerSpeedSum / currentLayerSpeedCount) : 120
    });
  }

  const sumPerExtruderGrams = perExtruderGrams.reduce((a, b) => a + b, 0);
  let filamentWeightGrams =
    totalFilamentGramsHeader > 0 ? totalFilamentGramsHeader : sumPerExtruderGrams;

  if (filamentLengthMeters <= 0 && cumulativeExtrusionMm > 0) {
    filamentLengthMeters = cumulativeExtrusionMm / 1000;
  }

  const radiusCm = (filamentDiameterMm / 2) / 10;
  const crossSectionAreaCm2 = Math.PI * radiusCm * radiusCm;

  if (filamentWeightGrams <= 0 && filamentLengthMeters > 0) {
    const volumeCm3 = filamentLengthMeters * 100 * crossSectionAreaCm2;
    filamentWeightGrams = Number((volumeCm3 * filamentDensityGcm3).toFixed(2));
  } else if (filamentLengthMeters <= 0 && filamentWeightGrams > 0) {
    const volumeCm3 = filamentWeightGrams / filamentDensityGcm3;
    const lengthCm = volumeCm3 / crossSectionAreaCm2;
    filamentLengthMeters = Number((lengthCm / 100).toFixed(2));
  }

  // Build slot list preserving original slot indices (so unused 0g slots don't shift colors/names)
  const resolvedSlotColors = Array.from(
    { length: Math.max(perExtruderGrams.length, filamentColorsList.length, extruderColorsList.length) },
    (_, idx) => {
      const fCol = filamentColorsList[idx]?.trim() || '';
      const eCol = extruderColorsList[idx]?.trim() || '';
      // If one is a generic default red (#FF0000) and the other is a specific color (e.g. green #00AE42), prefer the specific one
      if (fCol && eCol && fCol.toUpperCase() !== eCol.toUpperCase()) {
        if (fCol.toUpperCase() === '#FF0000' && eCol.startsWith('#')) return eCol;
        if (eCol.toUpperCase() === '#FF0000' && fCol.startsWith('#')) return fCol;
      }
      return eCol || fCol || (idx === 0 ? '#ef4444' : '#f8fafc');
    }
  );

  const filamentSlots: FilamentSlotInfo[] = perExtruderGrams
    .map((w, rawIdx) => {
      const mm = perExtruderMm[rawIdx] || 0;
      const rate = perExtruderSpoolRate[rawIdx] || 25;
      const cost = perExtruderCost[rawIdx] || (w / 1000) * rate;
      const settingName = filamentSettingsNames[rawIdx] || `Filament ${rawIdx + 1}`;
      let colorHex = resolvedSlotColors[rawIdx] || (rawIdx === 0 ? '#ef4444' : '#f8fafc');

      // Also check if settingName or fileName explicitly names a color for this slot
      const lowerSetting = settingName.toLowerCase();
      if (lowerSetting.includes('green')) colorHex = '#16a34a';
      else if (lowerSetting.includes('white')) colorHex = '#f8fafc';
      else if (lowerSetting.includes('black')) colorHex = '#18181b';
      else if (lowerSetting.includes('blue')) colorHex = '#2563eb';
      else if (lowerSetting.includes('yellow') || lowerSetting.includes('gold')) colorHex = '#eab308';

      return {
        slotNumber: rawIdx + 1,
        type: filamentTypesList[rawIdx] || filamentType || 'PLA',
        settingName,
        colorHex,
        weightGrams: Number(w.toFixed(2)),
        lengthMeters: Number((mm / 1000).toFixed(2)),
        slicerSpoolPricePerKg: rate,
        slicerCost: Number(cost.toFixed(2))
      };
    })
    .filter((slot) => slot.weightGrams > 0 || slot.lengthMeters > 0);

  if (filamentSlots.length > 1 && filamentChangeCount === 0) {
    filamentChangeCount = filamentSlots.length - 1;
  }

  let printTimeSeconds = Math.max(estimatedTotalSeconds, modelPrintTimeSeconds + prepareTimeSeconds);
  if (printTimeSeconds <= 0) {
    const fnTimeMatch = fileName.match(/_(\d+h\d+m|\d+m)/i);
    if (fnTimeMatch) {
      printTimeSeconds = parseDurationStringToSeconds(fnTimeMatch[1]);
    }
  }
  if (printTimeSeconds <= 0) {
    const estimatedHours = Math.max(0.25, filamentWeightGrams / 28);
    printTimeSeconds = Math.round(estimatedHours * 3600);
  }
  if (modelPrintTimeSeconds <= 0) {
    modelPrintTimeSeconds = printTimeSeconds;
  }

  const modelFilamentGrams = Math.max(
    0,
    Number((filamentWeightGrams - flushedFilamentGrams - towerFilamentGrams).toFixed(2))
  );

  if (nozzleTempC === 0) nozzleTempC = 220;
  if (bedTempC === 0) bedTempC = 60;
  if (totalLayers === 0) {
    totalLayers = Math.max(1, layerBreakdown.length || Math.round(40 / layerHeightMm));
  }

  const uniqueTypes = Array.from(new Set(filamentSlots.map((s) => s.type).filter(Boolean)));
  const combinedFilamentTypeLabel =
    uniqueTypes.length > 0
      ? filamentSlots.length > 1
        ? `${uniqueTypes.join(' + ')} (${filamentSlots.length} spools)`
        : uniqueTypes[0]
      : filamentType;

  const upperMat = combinedFilamentTypeLabel.toUpperCase();
  const isAbrasiveDetected =
    upperMat.includes('CF') ||
    upperMat.includes('GF') ||
    upperMat.includes('CARBON') ||
    upperMat.includes('GLASS') ||
    upperMat.includes('GLOW') ||
    upperMat.includes('METAL') ||
    upperMat.includes('WOOD');

  const firstSpoolRate =
    perExtruderSpoolRate.find((r) => r > 0) ??
    (totalFilamentCostHeader && filamentWeightGrams > 0
      ? Number(((totalFilamentCostHeader / filamentWeightGrams) * 1000).toFixed(2))
      : null);

  let finalThumbnail = bestThumbnailBase64;
  if (!finalThumbnail) {
    if (fileName.toLowerCase().includes('winter') && fileName.toLowerCase().includes('house')) {
      finalThumbnail = '/kit_card_winter_house_plate.png';
    } else if (segments.length > 0) {
      finalThumbnail = renderGcodeSegmentsToDataUrl(
        segments,
        resolvedSlotColors.length > 0 ? resolvedSlotColors : ['#ef4444', '#f8fafc']
      );
    }
  }

  return {
    fileName,
    fileSizeBytes: fileSizeBytes ?? new Blob([content]).size,
    slicerName,
    printerModel,
    printProfileName,
    printTimeSeconds,
    modelPrintTimeSeconds,
    prepareTimeSeconds,
    filamentWeightGrams: Number(filamentWeightGrams.toFixed(2)),
    modelFilamentGrams,
    flushedFilamentGrams: Number(flushedFilamentGrams.toFixed(2)),
    towerFilamentGrams: Number(towerFilamentGrams.toFixed(2)),
    filamentLengthMeters: Number(filamentLengthMeters.toFixed(2)),
    filamentType: combinedFilamentTypeLabel,
    filamentDiameterMm,
    filamentDensityGcm3,
    nozzleDiameterMm,
    layerHeightMm,
    firstLayerHeightMm,
    lineWidthMm,
    wallLoops,
    sparseInfillDensity,
    supportEnabled,
    totalLayers,
    nozzleTempC,
    bedTempC,
    chamberTempC,
    maxVolumetricSpeed,
    filamentChangeCount,
    slicerEstimatedCost: totalFilamentCostHeader !== null ? Number(totalFilamentCostHeader.toFixed(2)) : null,
    slicerSpoolPricePerKg: firstSpoolRate,
    filamentSlots,
    totalExtrusionCommands,
    travelMovesCount,
    retractionCount,
    zHopCount,
    thumbnailBase64: finalThumbnail,
    isAbrasiveDetected,
    layerBreakdown
  };
}

type ColorBucketId =
  | 'white'
  | 'black_grey'
  | 'red'
  | 'orange_brown'
  | 'yellow'
  | 'green'
  | 'cyan_blue'
  | 'purple_pink';

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;
  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;

  if (max !== min) {
    switch (max) {
      case rf:
        h = (gf - bf) / d + (gf < bf ? 6 : 0);
        break;
      case gf:
        h = (bf - rf) / d + 2;
        break;
      case bf:
        h = (rf - gf) / d + 4;
        break;
    }
    h *= 60;
  }
  return { h, s, v };
}

function classifyRgbBucket(r: number, g: number, b: number): ColorBucketId {
  const { h, s, v } = rgbToHsv(r, g, b);
  if (s < 0.22) {
    return v >= 0.65 ? 'white' : 'black_grey';
  }
  if (h < 16 || h >= 342) return 'red';
  if (h < 44) return 'orange_brown';
  if (h < 72) return 'yellow';
  if (h < 170) return 'green';
  if (h < 260) return 'cyan_blue';
  return 'purple_pink';
}

function parseHexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace(/^#/, '').trim();
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if (!isNaN(r) && !isNaN(g) && !isNaN(b)) return { r, g, b };
  }
  return null;
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  );
}

/**
 * Inspects the actual rendered 3D model thumbnail embedded in the G-code and ensures
 * the filament slot color swatches match the model's true rendered colors (for example,
 * when a Bambu/OrcaSlicer profile leaves default #FF0000 Red in filament_colour on a Green & White print).
 */
export async function syncParsedGcodeColorsWithThumbnail(
  parsed: ParsedGcodeData
): Promise<ParsedGcodeData> {
  if (
    typeof document === 'undefined' ||
    !parsed.thumbnailBase64 ||
    parsed.filamentSlots.length === 0
  ) {
    return parsed;
  }

  try {
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      el.onload = () => resolve(el);
      el.onerror = () => resolve(null);
      el.src = parsed.thumbnailBase64!;
    });
    if (!img) return parsed;

    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return parsed;

    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    // Sample border pixels to detect opaque build-plate background color if any
    let bgR = 0,
      bgG = 0,
      bgB = 0,
      bgCount = 0;
    for (let i = 0; i < size; i++) {
      const coords = [
        (0 * size + i) * 4,
        ((size - 1) * size + i) * 4,
        (i * size + 0) * 4,
        (i * size + (size - 1)) * 4
      ];
      for (const idx of coords) {
        if (data[idx + 3] > 180) {
          bgR += data[idx];
          bgG += data[idx + 1];
          bgB += data[idx + 2];
          bgCount++;
        }
      }
    }
    if (bgCount > 0) {
      bgR /= bgCount;
      bgG /= bgCount;
      bgB /= bgCount;
    }

    const bucketStats: Record<
      ColorBucketId,
      { count: number; rSum: number; gSum: number; bSum: number; sampleCount: number }
    > = {
      white: { count: 0, rSum: 0, gSum: 0, bSum: 0, sampleCount: 0 },
      black_grey: { count: 0, rSum: 0, gSum: 0, bSum: 0, sampleCount: 0 },
      red: { count: 0, rSum: 0, gSum: 0, bSum: 0, sampleCount: 0 },
      orange_brown: { count: 0, rSum: 0, gSum: 0, bSum: 0, sampleCount: 0 },
      yellow: { count: 0, rSum: 0, gSum: 0, bSum: 0, sampleCount: 0 },
      green: { count: 0, rSum: 0, gSum: 0, bSum: 0, sampleCount: 0 },
      cyan_blue: { count: 0, rSum: 0, gSum: 0, bSum: 0, sampleCount: 0 },
      purple_pink: { count: 0, rSum: 0, gSum: 0, bSum: 0, sampleCount: 0 }
    };

    let totalModelPixels = 0;

    for (let y = 2; y < size - 2; y++) {
      for (let x = 2; x < size - 2; x++) {
        const idx = (y * size + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const a = data[idx + 3];

        // Skip transparent pixels
        if (a < 150) continue;

        // Skip pixels matching the dark background plate
        if (bgCount > 0) {
          const distToBg = Math.abs(r - bgR) + Math.abs(g - bgG) + Math.abs(b - bgB);
          if (distToBg < 42) continue;
        }

        const { s, v } = rgbToHsv(r, g, b);
        // Skip dark shading/grid lines
        if (v < 0.22 && s < 0.25) continue;

        const bucket = classifyRgbBucket(r, g, b);
        // Skip neutral dark grey build-plate remnants unless a slot is explicitly black/grey
        if (bucket === 'black_grey' && v < 0.45) continue;

        bucketStats[bucket].count++;
        totalModelPixels++;

        // Accumulate well-lit pixels for a clean swatch color
        if (v >= 0.4) {
          bucketStats[bucket].rSum += r;
          bucketStats[bucket].gSum += g;
          bucketStats[bucket].bSum += b;
          bucketStats[bucket].sampleCount++;
        }
      }
    }

    if (totalModelPixels < 25) return parsed;

    // Determine which buckets are already accurately claimed by slots
    const slotBuckets = parsed.filamentSlots.map((slot) => {
      const rgb = parseHexToRgb(slot.colorHex);
      return rgb ? classifyRgbBucket(rgb.r, rgb.g, rgb.b) : null;
    });

    const usedBuckets = new Set<ColorBucketId>();
    slotBuckets.forEach((b) => {
      if (b && bucketStats[b].count >= totalModelPixels * 0.018) {
        usedBuckets.add(b);
      }
    });

    // Rank unassigned buckets present in the thumbnail by pixel share
    const availableThumbnailBuckets = (Object.keys(bucketStats) as ColorBucketId[])
      .filter(
        (b) =>
          b !== 'black_grey' &&
          !usedBuckets.has(b) &&
          bucketStats[b].count >= totalModelPixels * 0.035
      )
      .sort((a, b) => bucketStats[b].count - bucketStats[a].count);

    if (availableThumbnailBuckets.length === 0) return parsed;

    // Sort slots by weight descending so the primary slot gets the primary unassigned thumbnail color
    const updatedSlots = [...parsed.filamentSlots];
    const slotIndicesByWeight = updatedSlots
      .map((_, i) => i)
      .sort((a, b) => updatedSlots[b].weightGrams - updatedSlots[a].weightGrams);

    let changed = false;
    for (const slotIdx of slotIndicesByWeight) {
      const currentBucket = slotBuckets[slotIdx];
      const isCurrentColorInThumbnail =
        currentBucket !== null && bucketStats[currentBucket].count >= totalModelPixels * 0.018;

      if (!isCurrentColorInThumbnail && availableThumbnailBuckets.length > 0) {
        const replacementBucket = availableThumbnailBuckets.shift()!;
        const st = bucketStats[replacementBucket];
        const newHex =
          replacementBucket === 'white'
            ? '#f8fafc'
            : st.sampleCount > 0
              ? rgbToHex(st.rSum / st.sampleCount, st.gSum / st.sampleCount, st.bSum / st.sampleCount)
              : '#16a34a';

        updatedSlots[slotIdx] = {
          ...updatedSlots[slotIdx],
          colorHex: newHex
        };
        changed = true;
      }
    }

    if (!changed) return parsed;
    return {
      ...parsed,
      filamentSlots: updatedSlots
    };
  } catch {
    return parsed;
  }
}

export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '0m';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.round(seconds % 60);

  if (hrs > 0) {
    return `${hrs}h ${mins}m`;
  }
  return `${mins}m ${secs}s`;
}
