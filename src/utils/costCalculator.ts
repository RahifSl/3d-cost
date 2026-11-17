import { CalculationInputs, ParsedGcodeData, PowerProfile, WearComponent } from '../types';

export interface ComponentWearBreakdown {
  component: WearComponent;
  effectiveLifespanHours: number;
  costPerHour: number;
  costForThisPrint: number;
  lifeConsumedPercent: number;
}

export interface FullCostReport {
  printHours: number;
  // Filament
  netFilamentGrams: number;
  wasteFilamentGrams: number;
  totalFilamentGrams: number;
  costPerGram: number;
  netFilamentCost: number;
  wasteFilamentCost: number;
  totalFilamentCost: number;
  spoolsConsumedPercent: number;

  // Electricity
  warmupKwh: number;
  steadyPrintKwh: number;
  totalKwh: number;
  effectiveAverageWatts: number;
  electricityCost: number;

  // Wear & Tear + Machine Depreciation
  componentBreakdowns: ComponentWearBreakdown[];
  consumableWearCost: number;
  machineDepreciationCost: number;
  totalWearAndDepreciationCost: number;

  // Risk & Labor
  subtotalHardCost: number;
  failureRiskBufferCost: number;
  totalManufacturingCost: number;
  laborCost: number;
  totalCostWithLabor: number;
  suggestedQuotePrice: number;
  estimatedProfit: number;
}

export function calculatePrintEconomics(
  gcode: ParsedGcodeData,
  inputs: CalculationInputs,
  powerProfile: PowerProfile,
  wearComponents: WearComponent[]
): FullCostReport {
  const printHours = Math.max(0.01, gcode.printTimeSeconds / 3600);

  // 1. Filament Calculations
  const costPerGram =
    inputs.spoolWeightGrams > 0 ? inputs.spoolPrice / inputs.spoolWeightGrams : 0;
  const netFilamentGrams = gcode.filamentWeightGrams;
  const wasteFilamentGrams = netFilamentGrams * (inputs.filamentWastePercent / 100);
  const totalFilamentGrams = netFilamentGrams + wasteFilamentGrams;

  const netFilamentCost = netFilamentGrams * costPerGram;
  const wasteFilamentCost = wasteFilamentGrams * costPerGram;
  const totalFilamentCost = netFilamentCost + wasteFilamentCost;
  const spoolsConsumedPercent =
    inputs.spoolWeightGrams > 0 ? (totalFilamentGrams / inputs.spoolWeightGrams) * 100 : 0;

  // 2. Electricity Calculations (Elegoo CC2 specific thermal modeling)
  let warmupKwh = 0;
  let steadyPrintKwh = 0;
  let totalKwh = 0;
  let effectiveAverageWatts = 0;

  if (inputs.customAverageWatts !== null && inputs.customAverageWatts > 0) {
    effectiveAverageWatts = inputs.customAverageWatts;
    totalKwh = (effectiveAverageWatts * printHours) / 1000;
    steadyPrintKwh = totalKwh;
  } else {
    const warmupHours = Math.min(printHours, powerProfile.warmupMinutes / 60);
    const remainingSteadyHours = Math.max(0, printHours - warmupHours);

    // Adjust steady watts slightly if G-code bed temperature differs from profile default
    const bedTempDelta = gcode.bedTempC - powerProfile.bedTempDefault;
    const thermalAdjustmentWatts = Math.max(-60, Math.min(95, bedTempDelta * 2.2));
    const adjustedSteadyWatts = Math.max(85, powerProfile.steadyPrintingWatts + thermalAdjustmentWatts);

    warmupKwh = (powerProfile.warmupWatts * warmupHours) / 1000;
    steadyPrintKwh = (adjustedSteadyWatts * remainingSteadyHours) / 1000;
    totalKwh = warmupKwh + steadyPrintKwh;
    effectiveAverageWatts = printHours > 0 ? (totalKwh * 1000) / printHours : adjustedSteadyWatts;
  }

  const electricityCost = totalKwh * inputs.electricityRatePerKwh;

  // 3. Wear & Tear Component Breakdown
  const componentBreakdowns: ComponentWearBreakdown[] = wearComponents.map((comp) => {
    const multiplier = inputs.isAbrasiveMaterial ? comp.abrasiveMultiplier : 1.0;
    const effectiveLifespanHours = Math.max(10, comp.lifespanHours / multiplier);
    const costPerHour = comp.replacementCost / effectiveLifespanHours;
    const costForThisPrint = costPerHour * printHours;
    const lifeConsumedPercent = (printHours / effectiveLifespanHours) * 100;

    return {
      component: comp,
      effectiveLifespanHours,
      costPerHour,
      costForThisPrint,
      lifeConsumedPercent
    };
  });

  const consumableWearCost = componentBreakdowns.reduce(
    (sum, item) => sum + item.costForThisPrint,
    0
  );

  const machineDepreciationCost =
    inputs.includeMachineDepreciation && inputs.printerLifespanHours > 0
      ? (inputs.printerPurchasePrice / inputs.printerLifespanHours) * printHours
      : 0;

  const totalWearAndDepreciationCost = consumableWearCost + machineDepreciationCost;

  // 4. Totals, Failure Amortization & Quote Pricing
  const subtotalHardCost = totalFilamentCost + electricityCost + totalWearAndDepreciationCost;
  const failureRiskBufferCost = subtotalHardCost * (inputs.failureRatePercent / 100);
  const totalManufacturingCost = subtotalHardCost + failureRiskBufferCost;

  const laborCost = (inputs.laborSetupMinutes / 60) * inputs.laborHourlyRate;
  const totalCostWithLabor = totalManufacturingCost + laborCost;
  const suggestedQuotePrice = totalCostWithLabor * inputs.markupMultiplier;
  const estimatedProfit = suggestedQuotePrice - totalCostWithLabor;

  return {
    printHours,
    netFilamentGrams,
    wasteFilamentGrams,
    totalFilamentGrams,
    costPerGram,
    netFilamentCost,
    wasteFilamentCost,
    totalFilamentCost,
    spoolsConsumedPercent,
    warmupKwh,
    steadyPrintKwh,
    totalKwh,
    effectiveAverageWatts,
    electricityCost,
    componentBreakdowns,
    consumableWearCost,
    machineDepreciationCost,
    totalWearAndDepreciationCost,
    subtotalHardCost,
    failureRiskBufferCost,
    totalManufacturingCost,
    laborCost,
    totalCostWithLabor,
    suggestedQuotePrice,
    estimatedProfit
  };
}
