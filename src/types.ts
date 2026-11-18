export interface WearComponent {
  id: string;
  name: string;
  category: 'Hotend & Extruder' | 'Motion & Mechanics' | 'Build Surface & Filtration' | 'Machine Depreciation';
  replacementCost: number;
  lifespanHours: number;
  abrasiveMultiplier: number;
  notes: string;
}

export interface FilamentSlotInfo {
  slotNumber: number;
  type: string;
  settingName: string;
  colorHex: string;
  weightGrams: number;
  lengthMeters: number;
  slicerSpoolPricePerKg: number;
  slicerCost: number;
}

export interface PrintBedPlate {
  id: string;
  index: number;
  name: string;
  thumbnailBase64?: string | null;
  printTimeSeconds: number;
  filamentWeightGrams: number;
  flushedFilamentGrams?: number;
  towerFilamentGrams?: number;
  filamentSlots: FilamentSlotInfo[];
  gcodeData: ParsedGcodeData;
}

export interface BatchPrintItem {
  id: string;
  name: string;
  fileName: string;
  plateName?: string;
  thumbnailBase64?: string | null;
  gcodeData: ParsedGcodeData;
  quantity: number;
  addedAt: number;
}

export interface SavedModelItem {
  id: string;
  fileName: string;
  displayName: string;
  importedAt: number;
  fileSizeBytes: number;
  format: '3mf' | 'gcode';
  thumbnailBase64: string | null;
  parsedData: ParsedGcodeData;
  platesCount?: number;
}

export interface ParsedGcodeData {
  fileName: string;
  fileSizeBytes: number;
  slicerName: string;
  printerModel: string;
  printProfileName: string;
  printTimeSeconds: number;
  modelPrintTimeSeconds: number;
  prepareTimeSeconds: number;
  filamentWeightGrams: number;
  modelFilamentGrams: number;
  flushedFilamentGrams: number;
  towerFilamentGrams: number;
  filamentLengthMeters: number;
  filamentType: string;
  filamentDiameterMm: number;
  filamentDensityGcm3: number;
  nozzleDiameterMm: number;
  layerHeightMm: number;
  firstLayerHeightMm: number;
  lineWidthMm: number;
  wallLoops: number;
  sparseInfillDensity: string;
  supportEnabled: boolean;
  totalLayers: number;
  nozzleTempC: number;
  bedTempC: number;
  chamberTempC: number;
  maxVolumetricSpeed: number;
  filamentChangeCount: number;
  slicerEstimatedCost: number | null;
  slicerSpoolPricePerKg: number | null;
  filamentSlots: FilamentSlotInfo[];
  totalExtrusionCommands: number;
  travelMovesCount: number;
  retractionCount: number;
  zHopCount: number;
  thumbnailBase64: string | null;
  isAbrasiveDetected: boolean;
  layerBreakdown: {
    zHeight: number;
    extrusionMm: number;
    speedMmS: number;
  }[];
  plates?: PrintBedPlate[];
  is3mf?: boolean;
}

export interface PowerProfile {
  id: string;
  name: string;
  materialTag: string;
  warmupWatts: number;
  warmupMinutes: number;
  steadyPrintingWatts: number;
  bedTempDefault: number;
  nozzleTempDefault: number;
  description: string;
}

export interface CalculationInputs {
  currencySymbol: string;
  electricityRatePerKwh: number;
  spoolPrice: number;
  spoolWeightGrams: number;
  filamentWastePercent: number;
  failureRatePercent: number;
  printerPurchasePrice: number;
  printerLifespanHours: number;
  includeMachineDepreciation: boolean;
  isAbrasiveMaterial: boolean;
  powerProfileId: string;
  customAverageWatts: number | null;
  laborSetupMinutes: number;
  laborHourlyRate: number;
  markupMultiplier: number;
}

export interface SampleGcodePreset {
  id: string;
  title: string;
  subtitle: string;
  fileName: string;
  gcodeContent: string;
  plates?: PrintBedPlate[];
}
