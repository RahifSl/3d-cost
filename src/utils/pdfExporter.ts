import { jsPDF } from 'jspdf';
import { CalculationInputs, ParsedGcodeData } from '../types';
import { FullCostReport } from './costCalculator';
import { formatDuration } from './gcodeParser';

export interface PdfExportResult {
  savedToFolder: boolean;
  folderName?: string;
  fileName: string;
}

async function resolveImageAsDataUrl(src: string | null): Promise<string | null> {
  if (!src) return null;
  if (src.startsWith('data:image/')) return src;
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function generateAndSavePrintCostPdf(
  gcode: ParsedGcodeData,
  inputs: CalculationInputs,
  report: FullCostReport,
  costDirHandle: FileSystemDirectoryHandle | null
): Promise<PdfExportResult> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const sym = inputs.currencySymbol;
  const cleanBaseName = gcode.fileName.replace(/\.(gcode|gco|g)$/i, '');
  const pdfFileName = `${cleanBaseName}_Cost_Report.pdf`;

  // Header Banner
  doc.setFillColor(15, 23, 42); // Slate-900
  doc.rect(0, 0, 210, 34, 'F');

  doc.setTextColor(245, 158, 11); // Amber-500
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('ELEGOO CENTAURI CARBON 2 — PRINT COST & WEAR REPORT', 14, 13);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  const truncatedTitle =
    cleanBaseName.length > 46 ? cleanBaseName.slice(0, 44) + '...' : cleanBaseName;
  doc.text(truncatedTitle, 14, 22);

  doc.setTextColor(148, 163, 184);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(
    `Generated: ${new Date().toLocaleString()}  |  Slicer: ${gcode.slicerName}  |  Profile: ${gcode.printProfileName}`,
    14,
    29
  );

  // Model Picture + Top Total Cost Box
  let y = 42;

  // Left Box: 3D Model Picture
  doc.setDrawColor(226, 232, 240);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(14, y, 56, 56, 3, 3, 'FD');

  const resolvedThumb = await resolveImageAsDataUrl(gcode.thumbnailBase64);
  if (resolvedThumb && resolvedThumb.startsWith('data:image/')) {
    try {
      const format = resolvedThumb.includes('image/jpeg') ? 'JPEG' : 'PNG';
      doc.addImage(resolvedThumb, format, 16, y + 2, 52, 52);
    } catch {
      doc.setTextColor(100, 116, 139);
      doc.setFontSize(9);
      doc.text('Model Preview', 28, y + 28);
    }
  }

  // Right Box: Total Cost Receipt Summary
  doc.setFillColor(255, 251, 235);
  doc.setDrawColor(245, 158, 11);
  doc.roundedRect(76, y, 120, 56, 3, 3, 'FD');

  doc.setTextColor(180, 83, 9);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('TOTAL TRUE MANUFACTURING COST', 82, y + 10);

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(26);
  doc.text(`${sym}${report.totalManufacturingCost.toFixed(2)}`, 82, y + 23);

  doc.setTextColor(71, 85, 105);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(
    `Hourly Run Cost: ${sym}${(report.totalManufacturingCost / report.printHours).toFixed(2)}/hr   |   Print Time: ${formatDuration(gcode.printTimeSeconds)}`,
    82,
    y + 31
  );

  // 3 Mini Pillars inside the summary box
  doc.setDrawColor(253, 230, 138);
  doc.line(82, y + 35, 190, y + 35);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(37, 99, 235);
  doc.text(`1. Filament: ${sym}${report.totalFilamentCost.toFixed(2)}`, 82, y + 43);

  doc.setTextColor(5, 150, 105);
  doc.text(`2. Electricity: ${sym}${report.electricityCost.toFixed(2)}`, 122, y + 43);

  doc.setTextColor(217, 119, 6);
  doc.text(`3. Wear: ${sym}${report.totalWearAndDepreciationCost.toFixed(2)}`, 162, y + 43);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(`${report.totalFilamentGrams.toFixed(2)}g @ ${sym}${inputs.spoolPrice}/kg`, 82, y + 49);
  doc.text(`${report.totalKwh.toFixed(2)} kWh @ ${sym}${inputs.electricityRatePerKwh}/kWh`, 122, y + 49);
  doc.text(`5 CC2 Consumables`, 162, y + 49);

  // Section 1: Extracted G-Code & Filament Details
  y = 108;
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('1. Print & Filament Summary', 14, y);

  y += 4;
  doc.setDrawColor(203, 213, 225);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(14, y, 182, 26, 2, 2, 'FD');

  doc.setFontSize(9);
  doc.setTextColor(51, 65, 85);
  doc.setFont('helvetica', 'normal');
  doc.text(`Total Print Time: ${formatDuration(gcode.printTimeSeconds)} (Model: ${formatDuration(gcode.modelPrintTimeSeconds)}, Prep: ${formatDuration(gcode.prepareTimeSeconds)})`, 19, y + 8);
  doc.text(`Total Filament: ${gcode.filamentWeightGrams.toFixed(2)}g (${gcode.filamentLengthMeters}m) — Model: ${gcode.modelFilamentGrams.toFixed(2)}g, Flushed: ${gcode.flushedFilamentGrams.toFixed(2)}g, Tower: ${gcode.towerFilamentGrams.toFixed(2)}g`, 19, y + 15);
  doc.text(`Temperatures & Layer: Nozzle ${gcode.nozzleTempC}°C / Bed ${gcode.bedTempC}°C  |  Nozzle ${gcode.nozzleDiameterMm}mm  |  Layer ${gcode.layerHeightMm}mm (${gcode.totalLayers} layers)`, 19, y + 22);

  y += 33;

  // Multi-Spool Slots if present
  if (gcode.filamentSlots.length > 0) {
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Filament Slots Used:', 14, y);
    y += 5;

    for (const slot of gcode.filamentSlots) {
      const slotCost = (slot.weightGrams / inputs.spoolWeightGrams) * inputs.spoolPrice;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(51, 65, 85);
      doc.text(
        `• Slot #${slot.slotNumber} (${slot.settingName} - ${slot.type}): ${slot.weightGrams.toFixed(2)}g (${slot.lengthMeters.toFixed(2)}m)  —  ${sym}${slotCost.toFixed(2)}`,
        18,
        y
      );
      y += 5.5;
    }
    y += 3;
  }

  // Section 2: Elegoo CC2 Consumable Wear & Machine Depreciation Breakdown
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(
    `2. Elegoo CC2 Wear & Printer Depreciation (${sym}${report.totalWearAndDepreciationCost.toFixed(2)} Total)`,
    14,
    y
  );
  y += 5;

  // Table header
  doc.setFillColor(241, 245, 249);
  doc.rect(14, y, 182, 7, 'F');
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.text('Part / Depreciation Item', 17, y + 5);
  doc.text('Replacement Rate', 118, y + 5);
  doc.text('Life Used', 155, y + 5);
  doc.text('Print Cost', 178, y + 5);
  y += 7;

  doc.setFont('helvetica', 'normal');
  for (const item of report.componentBreakdowns) {
    doc.setDrawColor(226, 232, 240);
    doc.line(14, y + 7, 196, y + 7);
    doc.setTextColor(15, 23, 42);
    const shortName =
      item.component.name.length > 55
        ? item.component.name.slice(0, 53) + '...'
        : item.component.name;
    doc.text(shortName, 17, y + 5);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `${sym}${item.component.replacementCost.toFixed(2)} / ${Math.round(item.effectiveLifespanHours)}h`,
      118,
      y + 5
    );
    doc.text(`${item.lifeConsumedPercent.toFixed(2)}%`, 155, y + 5);
    doc.setTextColor(180, 83, 9);
    doc.setFont('helvetica', 'bold');
    doc.text(`${sym}${item.costForThisPrint.toFixed(3)}`, 178, y + 5);
    doc.setFont('helvetica', 'normal');
    y += 7.5;
  }

  if (inputs.includeMachineDepreciation) {
    const depLifePct = (report.printHours / Math.max(1, inputs.printerLifespanHours)) * 100;
    doc.setDrawColor(226, 232, 240);
    doc.line(14, y + 7, 196, y + 7);
    doc.setTextColor(15, 23, 42);
    doc.text('Elegoo CC2 Full Printer Depreciation', 17, y + 5);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `${sym}${inputs.printerPurchasePrice.toFixed(0)} / ${inputs.printerLifespanHours}h`,
      118,
      y + 5
    );
    doc.text(`${depLifePct.toFixed(2)}%`, 155, y + 5);
    doc.setTextColor(180, 83, 9);
    doc.setFont('helvetica', 'bold');
    doc.text(`${sym}${report.machineDepreciationCost.toFixed(3)}`, 178, y + 5);
    doc.setFont('helvetica', 'normal');
    y += 7.5;
  }

  // Footer
  doc.setTextColor(148, 163, 184);
  doc.setFontSize(8);
  doc.text(
    'Elegoo Centauri Carbon 2 Cost & Wear Calculator — Saved automatically to your Cost folder.',
    14,
    285
  );

  const pdfArrayBuffer = doc.output('arraybuffer');

  // If the user has connected their Desktop "Cost" folder, write directly into it!
  if (costDirHandle) {
    try {
      const permHandle = costDirHandle as unknown as {
        queryPermission?: (opts: { mode: string }) => Promise<string>;
        requestPermission?: (opts: { mode: string }) => Promise<string>;
      };
      if (permHandle.queryPermission) {
        let perm = await permHandle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted' && permHandle.requestPermission) {
          perm = await permHandle.requestPermission({ mode: 'readwrite' });
        }
        if (perm === 'granted') {
          const fileHandle = await costDirHandle.getFileHandle(pdfFileName, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(pdfArrayBuffer);
          await writable.close();
          return {
            savedToFolder: true,
            folderName: costDirHandle.name,
            fileName: pdfFileName
          };
        }
      }
    } catch {
      // Fall back to standard browser download if permission was declined
    }
  }

  // Fallback: standard browser PDF download
  doc.save(pdfFileName);
  return {
    savedToFolder: false,
    fileName: pdfFileName
  };
}
