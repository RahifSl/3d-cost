import { jsPDF } from 'jspdf';
import { BatchPrintItem, CalculationInputs, ParsedGcodeData, PowerProfile, WearComponent } from '../types';
import { calculatePrintEconomics, FullCostReport } from './costCalculator';
import { formatDuration } from './gcodeParser';

export interface PdfExportOptions {
  docType?: 'workshop' | 'quote';
  clientName?: string;
  businessName?: string;
  notes?: string;
  batchTitle?: string;
}

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
  costDirHandle: FileSystemDirectoryHandle | null,
  options?: PdfExportOptions
): Promise<PdfExportResult> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const isQuote = options?.docType === 'quote';
  const sym = inputs.currencySymbol;
  const cleanBaseName = gcode.fileName.replace(/\.(gcode|gco|g|3mf)$/i, '');
  const pdfPrefix = isQuote ? 'Quotation' : 'Cost_Report';
  const pdfFileName = `${cleanBaseName}_${pdfPrefix}.pdf`;

  // Header Banner
  doc.setFillColor(15, 23, 42); // Slate-900
  doc.rect(0, 0, 210, 34, 'F');

  doc.setTextColor(245, 158, 11); // Amber-500
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(
    isQuote
      ? (options?.businessName ? options.businessName.toUpperCase() : '3D PRINTING SERVICE') + ' — COMMERCIAL QUOTATION'
      : 'ELEGOO CENTAURI CARBON 2 — PRINT COST & WEAR REPORT',
    14,
    13
  );

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  const truncatedTitle =
    cleanBaseName.length > 46 ? cleanBaseName.slice(0, 44) + '...' : cleanBaseName;
  doc.text(truncatedTitle, 14, 22);

  doc.setTextColor(148, 163, 184);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(
    `Date: ${new Date().toLocaleDateString()}  |  ${options?.clientName ? `Client: ${options.clientName}  |  ` : ''}Printer: ${gcode.printerModel}  |  Slicer: ${gcode.slicerName}`,
    14,
    29
  );

  // Model Picture + Top Total Box
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

  // Right Box: Price / Cost Summary
  doc.setFillColor(255, 251, 235);
  doc.setDrawColor(245, 158, 11);
  doc.roundedRect(76, y, 120, 56, 3, 3, 'FD');

  doc.setTextColor(180, 83, 9);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(isQuote ? 'SUGGESTED CLIENT QUOTE (ESTIMATED TOTAL)' : 'TOTAL TRUE MANUFACTURING COST', 82, y + 10);

  const primaryPrice = isQuote ? report.suggestedQuotePrice : report.totalManufacturingCost;
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(26);
  doc.text(`${sym}${primaryPrice.toFixed(2)}`, 82, y + 23);

  doc.setTextColor(71, 85, 105);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(
    `Total Print Time: ${formatDuration(gcode.printTimeSeconds)}   |   Filament: ${gcode.filamentWeightGrams.toFixed(1)}g (${gcode.filamentType})`,
    82,
    y + 31
  );

  // 3 Mini Pillars inside summary box
  doc.setDrawColor(253, 230, 138);
  doc.line(82, y + 35, 190, y + 35);

  if (isQuote) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(37, 99, 235);
    doc.text(`Materials & Print: ${sym}${report.totalManufacturingCost.toFixed(2)}`, 82, y + 43);

    doc.setTextColor(5, 150, 105);
    doc.text(`Labor & Setup: ${sym}${report.laborCost.toFixed(2)}`, 130, y + 43);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(`${gcode.filamentWeightGrams.toFixed(1)}g on ${gcode.plates ? `${gcode.plates.length} beds` : '1 bed'}`, 82, y + 49);
    doc.text(`${inputs.laborSetupMinutes}m prep @ ${sym}${inputs.laborHourlyRate}/h`, 130, y + 49);
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(37, 99, 235);
    doc.text(`1. Filament: ${sym}${report.totalFilamentCost.toFixed(2)}`, 82, y + 43);

    doc.setTextColor(5, 150, 105);
    doc.text(`2. Power: ${sym}${report.electricityCost.toFixed(2)}`, 122, y + 43);

    doc.setTextColor(217, 119, 6);
    doc.text(`3. Wear: ${sym}${report.totalWearAndDepreciationCost.toFixed(2)}`, 162, y + 43);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(`${report.totalFilamentGrams.toFixed(2)}g @ ${sym}${inputs.spoolPrice}/kg`, 82, y + 49);
    doc.text(`${report.totalKwh.toFixed(2)} kWh @ ${sym}${inputs.electricityRatePerKwh}/kWh`, 122, y + 49);
    doc.text(`5 CC2 Consumables`, 162, y + 49);
  }

  // Section 1: Overview
  y = 106;
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('1. Project & Print Specifications', 14, y);

  y += 4;
  doc.setDrawColor(203, 213, 225);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(14, y, 182, 24, 2, 2, 'FD');

  doc.setFontSize(8.5);
  doc.setTextColor(51, 65, 85);
  doc.setFont('helvetica', 'normal');
  doc.text(
    `Print Time: ${formatDuration(gcode.printTimeSeconds)} (Model: ${formatDuration(gcode.modelPrintTimeSeconds)}, Prep: ${formatDuration(gcode.prepareTimeSeconds)})  |  Total Layers: ${gcode.totalLayers}`,
    19,
    y + 7
  );
  doc.text(
    `Filament Used: ${gcode.filamentWeightGrams.toFixed(2)}g (${gcode.filamentLengthMeters}m) — ${gcode.filamentType}  |  Nozzle: ${gcode.nozzleDiameterMm}mm · Layer: ${gcode.layerHeightMm}mm`,
    19,
    y + 14
  );
  doc.text(
    `Temperatures: Hotend ${gcode.nozzleTempC}°C  |  Heatbed ${gcode.bedTempC}°C  |  Chamber: ${gcode.chamberTempC}°C`,
    19,
    y + 20
  );

  y += 30;

  // Multi-Printbed Itemized Table if project has multiple plates
  if (gcode.plates && gcode.plates.length > 1) {
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text(`Multi-Printbed Itemized Breakdown (${gcode.plates.length} Plates):`, 14, y);
    y += 4;

    // Table Header
    doc.setFillColor(241, 245, 249);
    doc.rect(14, y, 182, 6.5, 'F');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text('Plate #', 17, y + 4.5);
    doc.text('Printbed Name', 34, y + 4.5);
    doc.text('Material / Color', 105, y + 4.5);
    doc.text('Print Time', 145, y + 4.5);
    doc.text('Weight', 175, y + 4.5);
    y += 6.5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    for (const plate of gcode.plates) {
      doc.setDrawColor(226, 232, 240);
      doc.line(14, y + 6, 196, y + 6);
      doc.setTextColor(15, 23, 42);

      doc.text(`Plate ${plate.index}`, 17, y + 4.5);

      const truncatedName = plate.name.length > 38 ? plate.name.slice(0, 36) + '...' : plate.name;
      doc.text(truncatedName, 34, y + 4.5);

      const colorLabel = plate.filamentSlots[0] ? `${plate.filamentSlots[0].type} (${plate.filamentSlots[0].colorHex})` : 'PLA';
      doc.text(colorLabel, 105, y + 4.5);

      doc.text(formatDuration(plate.printTimeSeconds), 145, y + 4.5);

      doc.setFont('helvetica', 'bold');
      doc.text(`${plate.filamentWeightGrams.toFixed(1)}g`, 175, y + 4.5);
      doc.setFont('helvetica', 'normal');
      y += 6.5;
    }
    y += 4;
  }

  // Multi-Spool Slots
  if (gcode.filamentSlots.length > 0) {
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text('Filament Spool Breakdown:', 14, y);
    y += 4.5;

    for (const slot of gcode.filamentSlots) {
      const slotCost = (slot.weightGrams / inputs.spoolWeightGrams) * inputs.spoolPrice;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(51, 65, 85);
      doc.text(
        `• Slot #${slot.slotNumber} (${slot.settingName} · ${slot.colorHex}): ${slot.weightGrams.toFixed(2)}g (${slot.lengthMeters.toFixed(2)}m)  —  ${sym}${slotCost.toFixed(2)}`,
        18,
        y
      );
      y += 5;
    }
    y += 3;
  }

  // Section 2: Wear & Depreciation Breakdown (Workshop mode) or Terms & Labor (Quote mode)
  if (!isQuote) {
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text(
      `2. Machine Wear & Depreciation (${sym}${report.totalWearAndDepreciationCost.toFixed(2)} Total)`,
      14,
      y
    );
    y += 4.5;

    doc.setFillColor(241, 245, 249);
    doc.rect(14, y, 182, 6, 'F');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text('Part / Maintenance Item', 17, y + 4.2);
    doc.text('Replacement Rate', 118, y + 4.2);
    doc.text('Life Used', 155, y + 4.2);
    doc.text('Print Cost', 178, y + 4.2);
    y += 6;

    doc.setFont('helvetica', 'normal');
    for (const item of report.componentBreakdowns) {
      doc.setDrawColor(226, 232, 240);
      doc.line(14, y + 6, 196, y + 6);
      doc.setTextColor(15, 23, 42);
      const shortName =
        item.component.name.length > 55
          ? item.component.name.slice(0, 53) + '...'
          : item.component.name;
      doc.text(shortName, 17, y + 4.2);
      doc.setTextColor(100, 116, 139);
      doc.text(
        `${sym}${item.component.replacementCost.toFixed(2)} / ${Math.round(item.effectiveLifespanHours)}h`,
        118,
        y + 4.2
      );
      doc.text(`${item.lifeConsumedPercent.toFixed(2)}%`, 155, y + 4.2);
      doc.setTextColor(180, 83, 9);
      doc.setFont('helvetica', 'bold');
      doc.text(`${sym}${item.costForThisPrint.toFixed(3)}`, 178, y + 4.2);
      doc.setFont('helvetica', 'normal');
      y += 6.5;
    }
  } else {
    // Client Quotation Notes & Terms Box
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text('2. Quotation Terms & Delivery Notes', 14, y);
    y += 4.5;

    doc.setDrawColor(203, 213, 225);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(14, y, 182, 32, 2, 2, 'FD');

    doc.setFontSize(8.5);
    doc.setTextColor(51, 65, 85);
    doc.setFont('helvetica', 'normal');
    doc.text(
      `• Turnaround Estimate: ~${Math.max(1, Math.ceil(gcode.printTimeSeconds / 28800))} business day(s) from print confirmation.`,
      18,
      y + 7
    );
    doc.text(
      `• Print Surface: High-adhesion Textured PEI with clean post-processing and support removal.`,
      18,
      y + 14
    );
    doc.text(
      `• Multi-Bed Project: Includes ${gcode.plates ? gcode.plates.length : 1} separate colored build plates, inspected and bagged.`,
      18,
      y + 21
    );
    doc.text(
      `• Quotation valid for 14 days from generation date.`,
      18,
      y + 28
    );
    y += 38;
  }

  // Footer
  doc.setTextColor(148, 163, 184);
  doc.setFontSize(8);
  doc.text(
    `Elegoo Centauri Carbon 2 · ${isQuote ? 'Official Quotation' : 'Internal Workshop Cost & Wear Report'} · Generated by 3d-cost`,
    14,
    285
  );

  const pdfArrayBuffer = doc.output('arraybuffer');

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
      // Fallback
    }
  }

  doc.save(pdfFileName);
  return {
    savedToFolder: false,
    fileName: pdfFileName
  };
}

/**
 * Generates and saves a consolidated multi-print batch PDF cost report or commercial quotation.
 */
export async function generateAndSaveBatchCostPdf(
  items: BatchPrintItem[],
  inputs: CalculationInputs,
  powerProfile: PowerProfile,
  wearComponents: WearComponent[],
  costDirHandle: FileSystemDirectoryHandle | null,
  options?: PdfExportOptions
): Promise<PdfExportResult> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const isQuote = options?.docType === 'quote';
  const sym = inputs.currencySymbol;
  const batchTitle = options?.batchTitle || (isQuote ? '3D Printing Multi-Print Quotation' : 'Multi-Print Production Cost Report');
  const pdfPrefix = isQuote ? 'Batch_Quotation' : 'Batch_Cost_Report';
  const pdfFileName = `${pdfPrefix}_${items.length}_Prints_${new Date().toISOString().slice(0, 10)}.pdf`;

  // Compute reports for each item
  const itemCalculations = items.map((item) => {
    const qty = Math.max(1, item.quantity);
    const report = calculatePrintEconomics(item.gcodeData, inputs, powerProfile, wearComponents);
    const unitPrice = isQuote ? report.suggestedQuotePrice : report.totalManufacturingCost;
    const totalPrice = unitPrice * qty;

    return {
      item,
      qty,
      report,
      unitPrice,
      totalPrice,
      totalTimeSecs: item.gcodeData.printTimeSeconds * qty,
      totalWeightGrams: item.gcodeData.filamentWeightGrams * qty,
      totalFilamentCost: report.totalFilamentCost * qty,
      totalElectricityCost: report.electricityCost * qty,
      totalWearCost: report.totalWearAndDepreciationCost * qty,
      totalLaborCost: report.laborCost * qty,
      totalKwh: report.totalKwh * qty
    };
  });

  const totalBatchPrice = itemCalculations.reduce((a, b) => a + b.totalPrice, 0);
  const totalBatchTimeSecs = itemCalculations.reduce((a, b) => a + b.totalTimeSecs, 0);
  const totalBatchWeightGrams = itemCalculations.reduce((a, b) => a + b.totalWeightGrams, 0);
  const totalBatchFilamentCost = itemCalculations.reduce((a, b) => a + b.totalFilamentCost, 0);
  const totalBatchElectricityCost = itemCalculations.reduce((a, b) => a + b.totalElectricityCost, 0);
  const totalBatchWearCost = itemCalculations.reduce((a, b) => a + b.totalWearCost, 0);
  const totalBatchLaborCost = itemCalculations.reduce((a, b) => a + b.totalLaborCost, 0);
  const totalBatchKwh = itemCalculations.reduce((a, b) => a + b.totalKwh, 0);
  const totalPartsCount = itemCalculations.reduce((a, b) => a + b.qty, 0);

  // Helper for page headers
  let pageNumber = 1;
  const drawPageHeader = (isFirstPage: boolean) => {
    doc.setFillColor(15, 23, 42); // Slate-900
    doc.rect(0, 0, 210, isFirstPage ? 34 : 18, 'F');

    doc.setTextColor(245, 158, 11); // Amber-500
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(isFirstPage ? 10 : 8.5);
    const headerPrefix = isQuote
      ? (options?.businessName ? options.businessName.toUpperCase() : '3D PRINTING SERVICE') + ' — COMMERCIAL QUOTATION'
      : 'ELEGOO CENTAURI CARBON 2 — MULTI-PRINT WORKSHOP REPORT';
    doc.text(headerPrefix, 14, isFirstPage ? 13 : 9);

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(isFirstPage ? 15 : 10);
    const titleText = isFirstPage ? batchTitle : `${batchTitle} (Continued)`;
    doc.text(titleText, 14, isFirstPage ? 22 : 14);

    if (isFirstPage) {
      doc.setTextColor(148, 163, 184);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.text(
        `Date: ${new Date().toLocaleDateString()}   |   ${options?.clientName ? `Client: ${options.clientName}   |   ` : ''}Total Setups: ${items.length}   |   Total Units: ${totalPartsCount} pcs`,
        14,
        29
      );
    }
  };

  const drawFooter = () => {
    doc.setTextColor(148, 163, 184);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(
      `Elegoo Centauri Carbon 2 · ${isQuote ? 'Consolidated Commercial Quotation' : 'Consolidated Workshop Production Report'} · Page ${pageNumber}`,
      14,
      287
    );
  };

  // Draw Page 1
  drawPageHeader(true);

  // Executive Summary Cards (3 Boxes)
  let y = 42;

  // Box 1: Total Price
  doc.setFillColor(255, 251, 235);
  doc.setDrawColor(245, 158, 11);
  doc.roundedRect(14, y, 64, 28, 2.5, 2.5, 'FD');
  doc.setTextColor(180, 83, 9);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(isQuote ? 'TOTAL QUOTE (ESTIMATED)' : 'TOTAL TRUE BATCH COST', 18, y + 8);
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(18);
  doc.text(`${sym}${totalBatchPrice.toFixed(2)}`, 18, y + 19);
  doc.setTextColor(100, 116, 139);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text(`Avg: ${sym}${(totalBatchPrice / Math.max(1, totalPartsCount)).toFixed(2)} / part`, 18, y + 24);

  // Box 2: Total Production Run Time
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(82, y, 58, 28, 2.5, 2.5, 'FD');
  doc.setTextColor(37, 99, 235);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('TOTAL PRINT RUN TIME', 86, y + 8);
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(16);
  doc.text(formatDuration(totalBatchTimeSecs), 86, y + 19);
  doc.setTextColor(100, 116, 139);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text(`${totalPartsCount} pieces (${items.length} print setups)`, 86, y + 24);

  // Box 3: Total Materials & Power
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(144, y, 52, 28, 2.5, 2.5, 'FD');
  doc.setTextColor(5, 150, 105);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('MATERIALS & ENERGY', 148, y + 8);
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(16);
  doc.text(`${totalBatchWeightGrams.toFixed(1)}g`, 148, y + 19);
  doc.setTextColor(100, 116, 139);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text(`${totalBatchKwh.toFixed(2)} kWh electrical draw`, 148, y + 24);

  y += 36;

  // Section 1: Itemized Print Jobs Table
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text(`1. Itemized Print Jobs & Plates (${items.length} Setups · ${totalPartsCount} Units Total)`, 14, y);
  y += 4;

  const drawTableHeader = (atY: number) => {
    doc.setFillColor(241, 245, 249);
    doc.rect(14, atY, 182, 6.5, 'F');
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(71, 85, 105);
    doc.text('#', 17, atY + 4.5);
    doc.text('Print Job / Plate Name', 25, atY + 4.5);
    doc.text('Material / Color', 94, atY + 4.5);
    doc.text('Qty', 128, atY + 4.5);
    doc.text('Time (ea / tot)', 139, atY + 4.5);
    doc.text('Weight', 165, atY + 4.5);
    doc.text(isQuote ? 'Total Price' : 'Total Cost', 181, atY + 4.5);
  };

  drawTableHeader(y);
  y += 6.5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);

  for (let i = 0; i < itemCalculations.length; i++) {
    const row = itemCalculations[i];

    // Page overflow check
    if (y > 255) {
      drawFooter();
      doc.addPage();
      pageNumber++;
      drawPageHeader(false);
      y = 26;
      drawTableHeader(y);
      y += 6.5;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
    }

    if (i % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(14, y, 182, 6.5, 'F');
    }

    doc.setDrawColor(226, 232, 240);
    doc.line(14, y + 6.5, 196, y + 6.5);
    doc.setTextColor(15, 23, 42);

    doc.text(`${i + 1}`, 17, y + 4.5);

    const displayName = row.item.name || row.item.fileName;
    const truncatedName = displayName.length > 36 ? displayName.slice(0, 34) + '...' : displayName;
    doc.text(truncatedName, 25, y + 4.5);

    const colorSlot = row.item.gcodeData.filamentSlots[0];
    const matLabel = colorSlot
      ? `${colorSlot.type} ${colorSlot.colorHex}`
      : row.item.gcodeData.filamentType || 'PLA';
    doc.text(matLabel.length > 18 ? matLabel.slice(0, 17) + '..' : matLabel, 94, y + 4.5);

    doc.setFont('helvetica', 'bold');
    doc.text(`${row.qty}x`, 128, y + 4.5);
    doc.setFont('helvetica', 'normal');

    const unitTimeStr = formatDuration(row.item.gcodeData.printTimeSeconds);
    const totTimeStr = formatDuration(row.totalTimeSecs);
    doc.text(row.qty > 1 ? `${unitTimeStr} (${totTimeStr})` : unitTimeStr, 139, y + 4.5);

    doc.text(`${row.totalWeightGrams.toFixed(1)}g`, 165, y + 4.5);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(180, 83, 9);
    doc.text(`${sym}${row.totalPrice.toFixed(2)}`, 181, y + 4.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42);

    y += 6.5;
  }

  // Totals Row
  doc.setFillColor(254, 243, 199);
  doc.rect(14, y, 182, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text('TOTAL BATCH SUMMARY:', 25, y + 5);
  doc.text(`${totalPartsCount} pcs`, 128, y + 5);
  doc.text(formatDuration(totalBatchTimeSecs), 139, y + 5);
  doc.text(`${totalBatchWeightGrams.toFixed(1)}g`, 165, y + 5);
  doc.setTextColor(180, 83, 9);
  doc.text(`${sym}${totalBatchPrice.toFixed(2)}`, 181, y + 5);

  y += 13;

  // Check if Section 2 fits on current page
  if (y > 215) {
    drawFooter();
    doc.addPage();
    pageNumber++;
    drawPageHeader(false);
    y = 26;
  }

  // Section 2: Financial & Operational Breakdown
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text('2. Consolidated Production Expenses Breakdown', 14, y);
  y += 4;

  doc.setDrawColor(203, 213, 225);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(14, y, 182, 34, 2, 2, 'FD');

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(51, 65, 85);

  doc.text(
    `• Raw Material (Filament): ${sym}${totalBatchFilamentCost.toFixed(2)}  (${totalBatchWeightGrams.toFixed(1)}g total consumed at ${sym}${inputs.spoolPrice}/kg)`,
    18,
    y + 7
  );
  doc.text(
    `• Electricity Draw: ${sym}${totalBatchElectricityCost.toFixed(2)}  (${totalBatchKwh.toFixed(2)} kWh across ${formatDuration(totalBatchTimeSecs)} at ${sym}${inputs.electricityRatePerKwh}/kWh)`,
    18,
    y + 14
  );
  doc.text(
    `• Real-World Machine Wear: ${sym}${totalBatchWearCost.toFixed(2)}  (Nozzles, PEI textured build plate, extruder gears, carbon filter & machine depreciation)`,
    18,
    y + 21
  );
  doc.text(
    `• Setup & Labor: ${sym}${totalBatchLaborCost.toFixed(2)}  (File preparation, multi-plate build bed clearing, post-processing & packing)`,
    18,
    y + 28
  );

  y += 40;

  // Section 3: Commercial Terms & Turnaround
  if (isQuote) {
    if (y > 235) {
      drawFooter();
      doc.addPage();
      pageNumber++;
      drawPageHeader(false);
      y = 26;
    }

    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text('3. Quotation Terms & Delivery Schedule', 14, y);
    y += 4;

    doc.setDrawColor(203, 213, 225);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(14, y, 182, 26, 2, 2, 'FD');

    const estDays = Math.max(1, Math.ceil(totalBatchTimeSecs / 28800));
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(51, 65, 85);
    doc.text(`• Turnaround Schedule: ~${estDays} to ${estDays + 2} business days from order confirmation and deposit.`, 18, y + 7);
    doc.text(`• Quality Guarantee: High-tolerance prints on Elegoo Centauri Carbon 2, inspected, support-removed, and bagged.`, 18, y + 14);
    doc.text(`• Quotation valid for 14 days from generation date. Prices exclude optional shipping.`, 18, y + 21);
  }

  drawFooter();

  const pdfArrayBuffer = doc.output('arraybuffer');

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
      // Fallback
    }
  }

  doc.save(pdfFileName);
  return {
    savedToFolder: false,
    fileName: pdfFileName
  };
}
