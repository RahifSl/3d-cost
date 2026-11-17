import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  Upload,
  Flame,
  RotateCcw,
  Download,
  Plus,
  Trash2,
  Sun,
  Moon,
  Check,
  ChevronDown,
  ChevronUp,
  FolderOpen,
  RefreshCw,
  MonitorDown,
  FileText,
  Image as ImageIcon
} from 'lucide-react';
import {
  ELEGOO_CC2_POWER_PROFILES,
  DEFAULT_ELEGOO_CC2_WEAR_COMPONENTS,
  SAMPLE_GCODE_PRESETS
} from './data/elegooCc2Presets';
import {
  parseGcodeFile,
  syncParsedGcodeColorsWithThumbnail,
  formatDuration
} from './utils/gcodeParser';
import { calculatePrintEconomics } from './utils/costCalculator';
import {
  FolderGcodeEntry,
  loadDirectoryHandleFromIdb,
  saveDirectoryHandleToIdb,
  clearDirectoryHandleFromIdb,
  scanDirectoryHandle,
  parseFileListToFolderEntries,
  GCODE_HANDLE_KEY,
  COST_PDF_HANDLE_KEY
} from './utils/folderWatcher';
import { generateAndSavePrintCostPdf } from './utils/pdfExporter';
import { usePWAInstall, useOnlineStatus } from './hooks/usePWAInstall';
import { CalculationInputs, ParsedGcodeData, WearComponent } from './types';

const STORAGE_KEY_INPUTS = 'elegoo_cc2_user_inputs_v4';
const STORAGE_KEY_WEAR = 'elegoo_cc2_wear_components_v2';

export default function App() {
  const [darkMode, setDarkMode] = useState<boolean>(true);
  const [activeSection, setActiveSection] = useState<'summary' | 'wear-editor' | 'gcode-details'>('summary');
  const [selectedPresetId, setSelectedPresetId] = useState<string>(SAMPLE_GCODE_PRESETS[0].id);

  // Initialize with the first preset (Kit Card Winter House 2-Color PLA)
  const [gcodeData, setGcodeData] = useState<ParsedGcodeData>(() =>
    parseGcodeFile(
      SAMPLE_GCODE_PRESETS[0].gcodeContent,
      SAMPLE_GCODE_PRESETS[0].fileName
    )
  );

  // Default spool price = $25.00/kg, electricity rate = $0.73/kWh, and includeMachineDepreciation = true
  const [inputs, setInputs] = useState<CalculationInputs>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_INPUTS);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          currencySymbol: parsed.currencySymbol ?? '$',
          electricityRatePerKwh:
            typeof parsed.electricityRatePerKwh === 'number' ? parsed.electricityRatePerKwh : 0.73,
          spoolPrice: typeof parsed.spoolPrice === 'number' ? parsed.spoolPrice : 25.0,
          spoolWeightGrams: parsed.spoolWeightGrams ?? 1000,
          filamentWastePercent: parsed.filamentWastePercent ?? 0,
          failureRatePercent: parsed.failureRatePercent ?? 0,
          printerPurchasePrice: parsed.printerPurchasePrice ?? 499.0,
          printerLifespanHours: parsed.printerLifespanHours ?? 4500,
          includeMachineDepreciation:
            typeof parsed.includeMachineDepreciation === 'boolean'
              ? parsed.includeMachineDepreciation
              : true,
          isAbrasiveMaterial: parsed.isAbrasiveMaterial ?? false,
          powerProfileId: parsed.powerProfileId ?? 'cc2-pla-highspeed',
          customAverageWatts: parsed.customAverageWatts ?? null,
          laborSetupMinutes: parsed.laborSetupMinutes ?? 0,
          laborHourlyRate: parsed.laborHourlyRate ?? 24.0,
          markupMultiplier: parsed.markupMultiplier ?? 1.5
        };
      }
    } catch {
      // Fallback to defaults
    }
    return {
      currencySymbol: '$',
      electricityRatePerKwh: 0.73,
      spoolPrice: 25.00,
      spoolWeightGrams: 1000,
      filamentWastePercent: 0,
      failureRatePercent: 0,
      printerPurchasePrice: 499.00,
      printerLifespanHours: 4500,
      includeMachineDepreciation: true, // Kept ticked ON by default as requested
      isAbrasiveMaterial: false,
      powerProfileId: 'cc2-pla-highspeed',
      customAverageWatts: null,
      laborSetupMinutes: 0,
      laborHourlyRate: 24.00,
      markupMultiplier: 1.5
    };
  });

  const [wearComponents, setWearComponents] = useState<WearComponent[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_WEAR);
      if (saved) return JSON.parse(saved);
    } catch {
      // Ignore
    }
    return DEFAULT_ELEGOO_CC2_WEAR_COMPONENTS;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_INPUTS, JSON.stringify(inputs));
    } catch {
      // Ignore
    }
  }, [inputs]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_WEAR, JSON.stringify(wearComponents));
    } catch {
      // Ignore
    }
  }, [wearComponents]);

  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [inputMode, setInputMode] = useState<'folder' | 'file' | 'manual'>('file');
  const [showAdvancedSettings, setShowAdvancedSettings] = useState<boolean>(false);
  const [copiedSummary, setCopiedSummary] = useState<boolean>(false);
  const [showDesktopGuideModal, setShowDesktopGuideModal] = useState<boolean>(false);

  // Watched G-Code Input Folder State
  const [dirHandle, setDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [savedDirHandle, setSavedDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [watchedFolderName, setWatchedFolderName] = useState<string>('');
  const [folderFiles, setFolderFiles] = useState<FolderGcodeEntry[]>([]);
  const [isScanningFolder, setIsScanningFolder] = useState<boolean>(false);
  const [autoLoadNewest, setAutoLoadNewest] = useState<boolean>(true);
  const [folderStatusMsg, setFolderStatusMsg] = useState<string>('');
  const lastNewestTimestampRef = useRef<number>(0);

  // Desktop "Cost" PDF Output Folder State
  const [costDirHandle, setCostDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [costFolderName, setCostFolderName] = useState<string>('');
  const [pdfExportToast, setPdfExportToast] = useState<string>('');
  const [isExportingPdf, setIsExportingPdf] = useState<boolean>(false);

  const [newPartName, setNewPartName] = useState<string>('');
  const [newPartCost, setNewPartCost] = useState<string>('12.00');
  const [newPartHours, setNewPartHours] = useState<string>('1000');

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fallbackFolderInputRef = useRef<HTMLInputElement | null>(null);
  const customImageInputRef = useRef<HTMLInputElement | null>(null);

  const { isInstallable, isInstalled, isInIframe, install } = usePWAInstall();
  const isOnline = useOnlineStatus();

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [darkMode]);

  // Check IndexedDB on mount for previously connected G-code folder and Desktop Cost PDF folder
  useEffect(() => {
    loadDirectoryHandleFromIdb(GCODE_HANDLE_KEY).then((handle) => {
      if (handle) {
        setSavedDirHandle(handle);
        setWatchedFolderName(handle.name);
      }
    });
    loadDirectoryHandleFromIdb(COST_PDF_HANDLE_KEY).then((handle) => {
      if (handle) {
        setCostDirHandle(handle);
        setCostFolderName(handle.name);
      }
    });
  }, []);

  const activePowerProfile = useMemo(() => {
    return (
      ELEGOO_CC2_POWER_PROFILES.find((p) => p.id === inputs.powerProfileId) ||
      ELEGOO_CC2_POWER_PROFILES[0]
    );
  }, [inputs.powerProfileId]);

  const report = useMemo(() => {
    return calculatePrintEconomics(gcodeData, inputs, activePowerProfile, wearComponents);
  }, [gcodeData, inputs, activePowerProfile, wearComponents]);

  // Auto-fills heating mode and abrasive setting from parsed G-code WITHOUT overwriting the user's spool price or electricity rate!
  const applyParsedGcodeToApp = useCallback((parsed: ParsedGcodeData) => {
    setGcodeData(parsed);
    syncParsedGcodeColorsWithThumbnail(parsed).then((synced) => {
      setGcodeData((curr) => (curr.fileName === synced.fileName ? synced : curr));
    });
    const matUpper = parsed.filamentType.toUpperCase();
    let matchedProfileId = 'cc2-pla-highspeed';

    if (matUpper.includes('CF') || matUpper.includes('GF') || matUpper.includes('PC') || matUpper.includes('PA')) {
      matchedProfileId = 'cc2-pa-cf-pc';
    } else if (matUpper.includes('ABS') || matUpper.includes('ASA')) {
      matchedProfileId = 'cc2-abs-asa';
    } else if (matUpper.includes('PETG')) {
      matchedProfileId = 'cc2-petg-pro';
    } else if (matUpper.includes('TPU') || matUpper.includes('FLEX')) {
      matchedProfileId = 'cc2-tpu-flex';
    }

    setInputs((prev) => ({
      ...prev,
      isAbrasiveMaterial: parsed.isAbrasiveDetected,
      powerProfileId: matchedProfileId
    }));
  }, []);

  const handleFileUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result;
      if (typeof content === 'string') {
        const parsed = parseGcodeFile(content, file.name, file.size);
        setSelectedPresetId('');
        applyParsedGcodeToApp(parsed);
      }
    };
    reader.readAsText(file);
  };

  const handleCustomModelImageUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result;
      if (typeof dataUrl === 'string') {
        setGcodeData((prev) => ({
          ...prev,
          thumbnailBase64: dataUrl
        }));
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSelectSamplePreset = (presetId: string) => {
    const found = SAMPLE_GCODE_PRESETS.find((p) => p.id === presetId);
    if (!found) return;
    setSelectedPresetId(presetId);
    const parsed = parseGcodeFile(found.gcodeContent, found.fileName);
    applyParsedGcodeToApp(parsed);
  };

  // Link Desktop "Cost" Folder for automatic PDF export
  const handleSelectCostOutputFolder = async (): Promise<FileSystemDirectoryHandle | null> => {
    const win = window as unknown as {
      showDirectoryPicker?: (opts?: {
        id?: string;
        mode?: 'read' | 'readwrite';
        startIn?: string;
      }) => Promise<FileSystemDirectoryHandle>;
    };

    if (typeof win.showDirectoryPicker === 'function' && !isInIframe) {
      try {
        const handle = await win.showDirectoryPicker({
          id: 'desktop_cost_folder',
          mode: 'readwrite',
          startIn: 'desktop'
        });
        setCostDirHandle(handle);
        setCostFolderName(handle.name);
        await saveDirectoryHandleToIdb(handle, COST_PDF_HANDLE_KEY);
        return handle;
      } catch {
        return null;
      }
    }
    return null;
  };

  // Export Cost Report to PDF (automatically writes into Desktop "Cost" folder if connected, or prompts once to pick it!)
  const handleExportCostPdf = async () => {
    setIsExportingPdf(true);
    try {
      let targetHandle = costDirHandle;
      const win = window as unknown as {
        showDirectoryPicker?: (opts?: {
          id?: string;
          mode?: 'read' | 'readwrite';
          startIn?: string;
        }) => Promise<FileSystemDirectoryHandle>;
      };

      // If no Cost folder is linked yet and browser supports directory picking, let user pick their Desktop "Cost" folder once
      if (!targetHandle && typeof win.showDirectoryPicker === 'function' && !isInIframe) {
        targetHandle = await handleSelectCostOutputFolder();
      }

      const result = await generateAndSavePrintCostPdf(gcodeData, inputs, report, targetHandle);
      if (result.savedToFolder) {
        setPdfExportToast(`Saved "${result.fileName}" directly to your "${result.folderName}" folder!`);
      } else {
        setPdfExportToast(`Downloaded "${result.fileName}"!`);
      }
      setTimeout(() => setPdfExportToast(''), 4500);
    } finally {
      setIsExportingPdf(false);
    }
  };

  // Scan an active FileSystemDirectoryHandle for G-code files
  const refreshWatchedFolder = useCallback(
    async (handleToScan: FileSystemDirectoryHandle, isInitialConnect = false) => {
      try {
        setIsScanningFolder(true);
        const entries = await scanDirectoryHandle(handleToScan);
        setFolderFiles(entries);
        setFolderStatusMsg(
          entries.length > 0
            ? `Watching "${handleToScan.name}" (${entries.length} G-code file${entries.length === 1 ? '' : 's'})`
            : `Connected to "${handleToScan.name}" — export a .gcode file from ElegooSlicer into this folder.`
        );

        if (entries.length > 0) {
          const newest = entries[0];
          if (
            isInitialConnect ||
            (autoLoadNewest && newest.lastModified > lastNewestTimestampRef.current)
          ) {
            lastNewestTimestampRef.current = newest.lastModified;
            setSelectedPresetId('');
            applyParsedGcodeToApp(newest.parsed);
          }
        }
      } catch {
        setFolderStatusMsg('Permission needed to re-scan folder. Click Reconnect below.');
      } finally {
        setIsScanningFolder(false);
      }
    },
    [autoLoadNewest, applyParsedGcodeToApp]
  );

  // Connect a local G-code folder using File System Access API
  const handleConnectLocalFolder = async () => {
    const win = window as unknown as {
      showDirectoryPicker?: (opts?: {
        id?: string;
        mode?: string;
      }) => Promise<FileSystemDirectoryHandle>;
    };

    if (typeof win.showDirectoryPicker === 'function' && !isInIframe) {
      try {
        const handle = await win.showDirectoryPicker({
          id: 'gcode_watch_folder',
          mode: 'read'
        });
        setDirHandle(handle);
        setSavedDirHandle(handle);
        setWatchedFolderName(handle.name);
        await saveDirectoryHandleToIdb(handle, GCODE_HANDLE_KEY);
        setInputMode('folder');
        await refreshWatchedFolder(handle, true);
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.toLowerCase().includes('abort')) return;
      }
    }

    fallbackFolderInputRef.current?.click();
  };

  const handleReconnectSavedFolder = async () => {
    if (!savedDirHandle) return;
    try {
      const permHandle = savedDirHandle as unknown as {
        requestPermission?: (opts: { mode: string }) => Promise<string>;
      };
      if (permHandle.requestPermission) {
        const status = await permHandle.requestPermission({ mode: 'read' });
        if (status !== 'granted') return;
      }
      setDirHandle(savedDirHandle);
      setInputMode('folder');
      await refreshWatchedFolder(savedDirHandle, true);
    } catch {
      handleConnectLocalFolder();
    }
  };

  const handleFallbackFolderInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsScanningFolder(true);
    try {
      const firstRelPath = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath || '';
      const folderTitle = firstRelPath.split('/')[0] || 'Selected G-Code Folder';
      setWatchedFolderName(folderTitle);
      const entries = await parseFileListToFolderEntries(files);
      setFolderFiles(entries);
      setInputMode('folder');
      setFolderStatusMsg(
        `Loaded ${entries.length} .gcode file${entries.length === 1 ? '' : 's'} from "${folderTitle}"`
      );
      if (entries.length > 0) {
        lastNewestTimestampRef.current = entries[0].lastModified;
        setSelectedPresetId('');
        applyParsedGcodeToApp(entries[0].parsed);
      }
    } finally {
      setIsScanningFolder(false);
    }
  };

  useEffect(() => {
    if (!dirHandle) return;
    const interval = setInterval(() => {
      refreshWatchedFolder(dirHandle, false);
    }, 4000);
    return () => clearInterval(interval);
  }, [dirHandle, refreshWatchedFolder]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
  };

  const handleUpdateWearComponent = (
    id: string,
    field: 'replacementCost' | 'lifespanHours' | 'abrasiveMultiplier',
    value: number
  ) => {
    setWearComponents((prev) =>
      prev.map((c) => (c.id === id ? { ...c, [field]: Math.max(0.1, value) } : c))
    );
  };

  const handleSwitchHotendReplacementMode = (mode: 'assembly' | 'nozzle-tip') => {
    setWearComponents((prev) =>
      prev.map((c) => {
        if (c.id !== 'hotend-complete-assembly') return c;
        if (mode === 'assembly') {
          return {
            ...c,
            name: 'Complete Hotend Assembly (0.4mm Hardened Nozzle + Heater + Thermistor)',
            replacementCost: 24.00,
            lifespanHours: 1500,
            abrasiveMultiplier: 2.2,
            notes: 'Official Elegoo CC2 pre-assembled hotend unit ($22–$25). Includes hardened steel nozzle, 60W ceramic heater, and thermistor.'
          };
        } else {
          return {
            ...c,
            name: 'High-Speed Hardened Nozzle Tip Only (Multi-Pack Rate)',
            replacementCost: 3.50,
            lifespanHours: 1000,
            abrasiveMultiplier: 2.2,
            notes: 'Individual replacement nozzle tip from an Elegoo multi-pack (~$24 for 8 nozzles).'
          };
        }
      })
    );
  };

  const handleAddWearComponent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPartName.trim()) return;
    const cost = parseFloat(newPartCost) || 12;
    const hours = parseFloat(newPartHours) || 1000;
    const added: WearComponent = {
      id: `custom-${Date.now()}`,
      name: newPartName.trim(),
      category: 'Hotend & Extruder',
      replacementCost: cost,
      lifespanHours: hours,
      abrasiveMultiplier: 1.5,
      notes: 'Custom user-added maintenance item.'
    };
    setWearComponents((prev) => [...prev, added]);
    setNewPartName('');
  };

  const handleDeleteWearComponent = (id: string) => {
    setWearComponents((prev) => prev.filter((c) => c.id !== id));
  };

  const handleResetWearDefaults = () => {
    setWearComponents(DEFAULT_ELEGOO_CC2_WEAR_COMPONENTS);
  };

  const handleCopyBreakdown = () => {
    const sym = inputs.currencySymbol;
    const text = [
      `Elegoo CC2 Print Cost — ${gcodeData.fileName}`,
      `Print Time: ${formatDuration(gcodeData.printTimeSeconds)} · Filament: ${report.totalFilamentGrams.toFixed(2)}g (${gcodeData.filamentType})`,
      `1. Filament Cost: ${sym}${report.totalFilamentCost.toFixed(2)} (@ ${sym}${inputs.spoolPrice}/kg)`,
      `2. Electricity Cost: ${sym}${report.electricityCost.toFixed(2)} (${report.totalKwh.toFixed(2)} kWh)`,
      `3. CC2 Consumable Wear: ${sym}${report.totalWearAndDepreciationCost.toFixed(2)} (${sym}${(report.totalWearAndDepreciationCost / report.printHours).toFixed(3)}/hr)`,
      `Total Cost: ${sym}${report.totalManufacturingCost.toFixed(2)}`
    ].join('\n');

    navigator.clipboard.writeText(text);
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 2000);
  };

  const sym = inputs.currencySymbol;
  const totalForBar = Math.max(0.0001, report.totalManufacturingCost);
  const filamentSharePct = (report.totalFilamentCost / totalForBar) * 100;
  const electricitySharePct = (report.electricityCost / totalForBar) * 100;
  const wearSharePct = (report.totalWearAndDepreciationCost / totalForBar) * 100;
  const hourlyConsumableWearRate = report.consumableWearCost / report.printHours;
  const hotendComp = wearComponents.find((c) => c.id === 'hotend-complete-assembly');
  const isCompleteHotendMode = hotendComp ? hotendComp.replacementCost >= 15 : true;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors">
      {/* PDF Saved Toast Notification */}
      {pdfExportToast && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2.5 rounded-xl bg-emerald-600 px-4 py-3 text-xs sm:text-sm font-semibold text-white shadow-xl">
          <Check className="w-4 h-4 shrink-0" />
          <span>{pdfExportToast}</span>
        </div>
      )}

      {/* Offline Indicator Banner */}
      {!isOnline && (
        <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-slate-950 shadow-lg">
          <span>Offline Mode — Running locally from cached desktop app</span>
        </div>
      )}

      {/* Hidden Fallback Directory Input for Preview Iframe */}
      <input
        ref={fallbackFolderInputRef}
        type="file"
        // @ts-expect-error webkitdirectory is standard across desktop browsers
        webkitdirectory="true"
        directory="true"
        multiple
        onChange={handleFallbackFolderInputChange}
        className="hidden"
      />

      {/* Hidden Custom Image Input if user wants to change the model picture */}
      <input
        ref={customImageInputRef}
        type="file"
        accept="image/*"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleCustomModelImageUpload(file);
        }}
        className="hidden"
      />

      {/* Top Bar Contract: Zone 1 Brand | Zone 2 Nav Links | Zone 3 Primary Action */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-8 px-6 py-3.5 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800">
        <a
          href="#top"
          className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0 font-display"
        >
          Elegoo CC2 Print Cost Calculator
        </a>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-400">
          <button
            type="button"
            onClick={() => setActiveSection('summary')}
            className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeSection === 'summary'
                ? 'text-amber-600 dark:text-amber-400 underline underline-offset-8 decoration-2'
                : ''
            }`}
          >
            Cost Summary
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('wear-editor')}
            className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeSection === 'wear-editor'
                ? 'text-amber-600 dark:text-amber-400 underline underline-offset-8 decoration-2'
                : ''
            }`}
          >
            Customize Part Lifespans
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('gcode-details')}
            className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeSection === 'gcode-details'
                ? 'text-amber-600 dark:text-amber-400 underline underline-offset-8 decoration-2'
                : ''
            }`}
          >
            G-Code Details
          </button>
          <button
            type="button"
            onClick={() => setShowDesktopGuideModal(true)}
            className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer text-amber-600 dark:text-amber-400"
          >
            <MonitorDown className="w-3.5 h-3.5" />
            <span>{isInstalled ? 'Desktop App Active' : 'Desktop App & Folders'}</span>
          </button>
          <button
            type="button"
            onClick={() => setDarkMode(!darkMode)}
            className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer"
          >
            {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            <span>{darkMode ? 'Light Mode' : 'Dark Mode'}</span>
          </button>
        </nav>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleExportCostPdf}
            disabled={isExportingPdf}
            className="px-4 py-2 text-xs font-semibold text-slate-950 bg-amber-500 hover:bg-amber-400 rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>
              {costFolderName
                ? `Export PDF → "${costFolderName}"`
                : 'Export PDF to "Cost" Folder'}
            </span>
          </button>
        </div>
      </header>

      <main id="top" className="max-w-[1360px] mx-auto px-4 sm:px-6 py-6">
        {/* Top Folder Connections Bar */}
        <div className="mb-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:px-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white">
              Elegoo Centauri Carbon 2 — G-Code Cost & Wear Calculator
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-0.5">
              Spool rate locked at <strong className="text-slate-900 dark:text-white font-mono">{sym}{inputs.spoolPrice}/kg</strong> · Power rate locked at <strong className="text-slate-900 dark:text-white font-mono">{sym}{inputs.electricityRatePerKwh}/kWh</strong>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleConnectLocalFolder}
              className="px-3.5 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <FolderOpen className="w-3.5 h-3.5 text-amber-500" />
              <span>
                {watchedFolderName ? `G-Code Folder: ${watchedFolderName}` : '1. Connect G-Code Input Folder'}
              </span>
            </button>

            <button
              type="button"
              onClick={handleSelectCostOutputFolder}
              className="px-3.5 py-2 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-600 dark:text-amber-400 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>
                {costFolderName
                  ? `PDF Folder: Desktop/${costFolderName}`
                  : '2. Link Desktop "Cost" PDF Folder'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setShowDesktopGuideModal(true)}
              className="px-3.5 py-2 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-600 dark:text-emerald-400 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>3. Download 100% Offline Desktop App</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* LEFT SIDE (5 Columns): Simple 3-Step Guided Inputs */}
          <div className="lg:col-span-5 space-y-5">
            {/* STEP 1: LOAD YOUR PRINT */}
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-amber-500 text-slate-950 font-bold text-xs flex items-center justify-center shrink-0">
                    1
                  </span>
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">
                    Load Your Print
                  </h2>
                </div>

                <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setInputMode('file')}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      inputMode === 'file'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Upload File
                  </button>
                  <button
                    type="button"
                    onClick={() => setInputMode('folder')}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      inputMode === 'folder'
                        ? 'bg-white dark:bg-slate-900 text-amber-600 dark:text-amber-400 shadow-xs font-semibold'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Watched Folder {folderFiles.length > 0 ? `(${folderFiles.length})` : ''}
                  </button>
                  <button
                    type="button"
                    onClick={() => setInputMode('manual')}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      inputMode === 'manual'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Manual
                  </button>
                </div>
              </div>

              {/* MODE A: UPLOAD SINGLE FILE */}
              {inputMode === 'file' && (
                <>
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl p-5 text-center transition-colors cursor-pointer ${
                      isDragging
                        ? 'border-amber-500 bg-amber-500/10'
                        : 'border-slate-300 dark:border-slate-700 hover:border-amber-500 bg-slate-50/70 dark:bg-slate-950/60'
                    }`}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".gcode,.gco,.g"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileUpload(file);
                      }}
                      className="hidden"
                    />
                    <Upload className="w-7 h-7 text-amber-500 mx-auto mb-2" />
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Drop your <span className="font-mono text-amber-600 dark:text-amber-400">.gcode</span> file here, or click to browse
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      Automatically pulls model picture, total time, filament slots & temperatures
                    </p>
                  </div>

                  {/* Quick Test Presets */}
                  <div className="mt-3.5">
                    <div className="text-xs text-slate-500 dark:text-slate-400 mb-1.5">
                      Or test with an included Elegoo CC2 G-code preset:
                    </div>
                    <div className="grid grid-cols-1 gap-1.5">
                      {SAMPLE_GCODE_PRESETS.map((preset) => {
                        const isSelected = selectedPresetId === preset.id;
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => handleSelectSamplePreset(preset.id)}
                            className={`text-left px-3 py-2 rounded-lg border text-xs transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                              isSelected
                                ? 'bg-amber-500/10 border-amber-500/60 text-slate-900 dark:text-white font-semibold'
                                : 'bg-slate-50 dark:bg-slate-950/50 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700'
                            }`}
                          >
                            <span className="truncate">{preset.title}</span>
                            <span className="font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
                              {preset.subtitle}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}

              {/* MODE B: LIVE WATCHED G-CODE FOLDER */}
              {inputMode === 'folder' && (
                <div className="space-y-3">
                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                        <FolderOpen className="w-4 h-4 text-amber-500 shrink-0" />
                        <span>
                          {watchedFolderName
                            ? `Folder: ${watchedFolderName}`
                            : 'Connect Your ElegooSlicer Export Folder'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {dirHandle && (
                          <button
                            type="button"
                            onClick={() => refreshWatchedFolder(dirHandle, false)}
                            className="px-2.5 py-1 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1 cursor-pointer"
                          >
                            <RefreshCw className={`w-3 h-3 ${isScanningFolder ? 'animate-spin' : ''}`} />
                            <span>Refresh</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={handleConnectLocalFolder}
                          className="px-3 py-1 text-xs font-semibold rounded-md bg-amber-500 text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer"
                        >
                          {watchedFolderName ? 'Change Folder' : 'Choose Folder'}
                        </button>
                      </div>
                    </div>

                    {savedDirHandle && !dirHandle && (
                      <div className="mt-2.5 pt-2.5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          Previously linked folder: <strong className="text-slate-800 dark:text-slate-200">{savedDirHandle.name}</strong>
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={handleReconnectSavedFolder}
                            className="text-xs font-semibold text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
                          >
                            Reconnect Live Watch
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              clearDirectoryHandleFromIdb(GCODE_HANDLE_KEY);
                              setSavedDirHandle(null);
                              setWatchedFolderName('');
                            }}
                            className="text-xs text-slate-400 hover:text-rose-500 cursor-pointer"
                          >
                            Forget
                          </button>
                        </div>
                      </div>
                    )}

                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2">
                      {folderStatusMsg ||
                        'Select the folder where you export .gcode files from ElegooSlicer. New exports appear at the top automatically.'}
                    </p>

                    <label className="mt-2.5 pt-2.5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                      <span>Auto-load newest exported G-code file immediately</span>
                      <input
                        type="checkbox"
                        checked={autoLoadNewest}
                        onChange={(e) => setAutoLoadNewest(e.target.checked)}
                        className="h-3.5 w-3.5 accent-amber-500 rounded cursor-pointer"
                      />
                    </label>
                  </div>

                  {folderFiles.length > 0 ? (
                    <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
                      {folderFiles.map((entry, idx) => {
                        const isCurrent = gcodeData.fileName === entry.name && selectedPresetId === '';
                        const entryCost = calculatePrintEconomics(
                          entry.parsed,
                          inputs,
                          activePowerProfile,
                          wearComponents
                        );
                        return (
                          <button
                            key={`${entry.name}-${entry.lastModified}`}
                            type="button"
                            onClick={() => {
                              setSelectedPresetId('');
                              applyParsedGcodeToApp(entry.parsed);
                            }}
                            className={`w-full text-left p-2.5 rounded-lg border text-xs transition-colors flex items-center justify-between gap-2.5 cursor-pointer ${
                              isCurrent
                                ? 'bg-amber-500/10 border-amber-500/60 text-slate-900 dark:text-white'
                                : 'bg-slate-50 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                            }`}
                          >
                            {entry.parsed.thumbnailBase64 && (
                              <img
                                src={entry.parsed.thumbnailBase64}
                                alt={entry.name}
                                referrerPolicy="no-referrer"
                                className="w-10 h-10 rounded object-cover bg-slate-900 border border-slate-700 shrink-0"
                              />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="font-semibold truncate flex items-center gap-1.5">
                                {idx === 0 && (
                                  <span className="text-[10px] font-mono uppercase text-amber-600 dark:text-amber-400 shrink-0">
                                    [Newest]
                                  </span>
                                )}
                                <span className="truncate font-mono">{entry.name}</span>
                              </div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5">
                                {formatDuration(entry.parsed.printTimeSeconds)} · {entry.parsed.filamentWeightGrams}g {entry.parsed.filamentType}
                              </div>
                            </div>
                            <div className="text-right shrink-0 font-mono tabular-nums">
                              <div className="text-sm font-bold text-amber-600 dark:text-amber-400">
                                {sym}{entryCost.totalManufacturingCost.toFixed(2)}
                              </div>
                              <div className="text-[10px] text-slate-500 dark:text-slate-400">
                                Fil: {sym}{entryCost.totalFilamentCost.toFixed(2)}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="p-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-800 text-center text-xs text-slate-500 dark:text-slate-400">
                      No folder loaded yet. Click <strong>Choose Folder</strong> above to select your ElegooSlicer export folder.
                    </div>
                  )}
                </div>
              )}

              {/* MODE C: MANUAL TIME & WEIGHT */}
              {inputMode === 'manual' && (
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Enter the print time and filament weight shown in your slicer preview:
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Print Time (Hours)
                      </label>
                      <input
                        type="number"
                        step="0.25"
                        min="0.1"
                        value={Number((gcodeData.printTimeSeconds / 3600).toFixed(2))}
                        onChange={(e) => {
                          const hrs = Math.max(0.05, parseFloat(e.target.value) || 0.1);
                          setGcodeData((prev) => ({
                            ...prev,
                            fileName: 'Manual_Estimate.gcode',
                            printTimeSeconds: Math.round(hrs * 3600),
                            modelPrintTimeSeconds: Math.round(hrs * 3600),
                            prepareTimeSeconds: 0
                          }));
                        }}
                        className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Filament Weight (Grams)
                      </label>
                      <input
                        type="number"
                        step="1"
                        min="1"
                        value={gcodeData.filamentWeightGrams}
                        onChange={(e) => {
                          const g = Math.max(1, parseFloat(e.target.value) || 1);
                          setGcodeData((prev) => ({
                            ...prev,
                            fileName: 'Manual_Estimate.gcode',
                            filamentWeightGrams: g,
                            modelFilamentGrams: g,
                            flushedFilamentGrams: 0,
                            towerFilamentGrams: 0,
                            filamentSlots: []
                          }));
                        }}
                        className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Clear "What We Read From Your G-Code File" Box */}
              <div className="mt-4 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-2.5">
                <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 flex items-center justify-between gap-2">
                  <span className="truncate font-mono" title={gcodeData.fileName}>
                    {gcodeData.fileName}
                  </span>
                  <span className="font-mono shrink-0">{gcodeData.filamentType}</span>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-emerald-500/20 text-center">
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Total Time</div>
                    <div className="text-sm font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                      {formatDuration(gcodeData.printTimeSeconds)}
                    </div>
                    {gcodeData.prepareTimeSeconds > 0 && (
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                        ({formatDuration(gcodeData.modelPrintTimeSeconds)} print + {formatDuration(gcodeData.prepareTimeSeconds)} prep)
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Total Filament</div>
                    <div className="text-sm font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                      {gcodeData.filamentWeightGrams.toFixed(2)}g
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                      {gcodeData.filamentLengthMeters}m
                      {gcodeData.flushedFilamentGrams + gcodeData.towerFilamentGrams > 0
                        ? ` (incl. ${(gcodeData.flushedFilamentGrams + gcodeData.towerFilamentGrams).toFixed(2)}g flush/tower)`
                        : ''}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Nozzle / Bed</div>
                    <div className="text-sm font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                      {gcodeData.nozzleTempC}° / {gcodeData.bedTempC}°C
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                      {gcodeData.nozzleDiameterMm}mm · {gcodeData.layerHeightMm}mm layer
                    </div>
                  </div>
                </div>

                {gcodeData.filamentSlots.length > 0 && (
                  <div className="pt-2 border-t border-emerald-500/20 space-y-1">
                    {gcodeData.filamentSlots.map((slot) => (
                      <div
                        key={slot.slotNumber}
                        className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-700 dark:text-slate-300"
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          <span
                            className="w-2.5 h-2.5 rounded-xs border border-slate-400/50 shrink-0"
                            style={{ backgroundColor: slot.colorHex }}
                          />
                          <span className="truncate">
                            Slot {slot.slotNumber}: {slot.settingName}
                          </span>
                        </div>
                        <span className="shrink-0">
                          {slot.weightGrams.toFixed(2)}g ({slot.lengthMeters.toFixed(2)}m)
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* STEP 2: ENTER YOUR FILAMENT & ELECTRICITY PRICES */}
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-amber-500 text-slate-950 font-bold text-xs flex items-center justify-center shrink-0">
                    2
                  </span>
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">
                    Your Filament & Power Prices
                  </h2>
                </div>

                <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
                  {['$', '€', '£', 'CA$', 'A$'].map((cur) => (
                    <button
                      key={cur}
                      type="button"
                      onClick={() => setInputs((prev) => ({ ...prev, currencySymbol: cur }))}
                      className={`px-2 py-0.5 text-xs font-mono rounded transition-colors cursor-pointer ${
                        inputs.currencySymbol === cur
                          ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs font-semibold'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {cur}
                    </button>
                  ))}
                </div>
              </div>

              {/* Price Input 1: Filament */}
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Filament Spool Price (Locked at your rate)
                  </label>
                  <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    = {sym}{report.costPerGram.toFixed(3)} / gram
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                      Spool Price ({sym})
                    </div>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={inputs.spoolPrice}
                      onChange={(e) =>
                        setInputs((prev) => ({
                          ...prev,
                          spoolPrice: Math.max(0, parseFloat(e.target.value) || 0)
                        }))
                      }
                      className="w-full px-3 py-2 text-sm font-mono tabular-nums font-semibold rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
                    />
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                      Spool Size (Grams)
                    </div>
                    <select
                      value={inputs.spoolWeightGrams}
                      onChange={(e) =>
                        setInputs((prev) => ({
                          ...prev,
                          spoolWeightGrams: parseInt(e.target.value, 10) || 1000
                        }))
                      }
                      className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
                    >
                      <option value={250}>250g Mini Spool</option>
                      <option value={500}>500g Half Spool</option>
                      <option value={750}>750g Spool</option>
                      <option value={1000}>1,000g (1 kg Standard)</option>
                      <option value={2000}>2,000g (2 kg Bulk)</option>
                      <option value={3000}>3,000g (3 kg Bulk)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Price Input 2: Electricity */}
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    What is your electricity price per kWh?
                  </label>
                  <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    CC2 draws ~{Math.round(report.effectiveAverageWatts)}W avg
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                      Rate ({sym} per kWh)
                    </div>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={inputs.electricityRatePerKwh}
                      onChange={(e) =>
                        setInputs((prev) => ({
                          ...prev,
                          electricityRatePerKwh: Math.max(0, parseFloat(e.target.value) || 0)
                        }))
                      }
                      className="w-full px-3 py-2 text-sm font-mono tabular-nums font-semibold rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
                    />
                  </div>

                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                      CC2 Heating Mode
                    </div>
                    <select
                      value={inputs.powerProfileId}
                      onChange={(e) =>
                        setInputs((prev) => ({
                          ...prev,
                          powerProfileId: e.target.value,
                          customAverageWatts: null
                        }))
                      }
                      className="w-full px-2.5 py-2 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
                    >
                      {ELEGOO_CC2_POWER_PROFILES.map((prof) => (
                        <option key={prof.id} value={prof.id}>
                          {prof.materialTag} (~{prof.steadyPrintingWatts}W)
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </section>

            {/* STEP 3: WEAR & TEAR OPTIONS */}
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-amber-500 text-slate-950 font-bold text-xs flex items-center justify-center shrink-0">
                    3
                  </span>
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">
                    Real-World Consumable Wear
                  </h2>
                </div>
                <span className="text-xs font-mono tabular-nums text-amber-600 dark:text-amber-400 font-semibold">
                  {sym}{hourlyConsumableWearRate.toFixed(3)} / hr
                </span>
              </div>

              <label className="flex items-start justify-between gap-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 cursor-pointer">
                <div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <Flame className="w-3.5 h-3.5 text-amber-500" />
                    <span>Printing Carbon Fiber / Glass Fiber / Glow?</span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Standard filaments cost ~{sym}0.062/hr in consumable wear. Abrasive CF/GF increases hotend & gear wear to ~{sym}0.101/hr.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={inputs.isAbrasiveMaterial}
                  onChange={(e) =>
                    setInputs((prev) => ({ ...prev, isAbrasiveMaterial: e.target.checked }))
                  }
                  className="mt-1 h-4 w-4 accent-amber-500 rounded cursor-pointer shrink-0"
                />
              </label>

              <label className="flex items-start justify-between gap-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 cursor-pointer">
                <div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-white">
                    Optional: Add Full Printer Depreciation (+{sym}{(inputs.printerPurchasePrice / Math.max(1, inputs.printerLifespanHours)).toFixed(2)}/hr)
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Leave off for personal prints. Turn on if pricing commercial print jobs.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={inputs.includeMachineDepreciation}
                  onChange={(e) =>
                    setInputs((prev) => ({ ...prev, includeMachineDepreciation: e.target.checked }))
                  }
                  className="mt-1 h-4 w-4 accent-amber-500 rounded cursor-pointer shrink-0"
                />
              </label>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
                  className="w-full py-2 px-3 rounded-lg border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center justify-between cursor-pointer"
                >
                  <span>Optional: Extra Waste %, Failure Risk & Smart-Plug Watts</span>
                  {showAdvancedSettings ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </button>

                {showAdvancedSettings && (
                  <div className="mt-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                          Extra Waste Buffer (%)
                        </label>
                        <input
                          type="number"
                          step="1"
                          min="0"
                          value={inputs.filamentWastePercent}
                          onChange={(e) =>
                            setInputs((prev) => ({
                              ...prev,
                              filamentWastePercent: Math.max(0, parseFloat(e.target.value) || 0)
                            }))
                          }
                          className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                          Failed Print Buffer (%)
                        </label>
                        <input
                          type="number"
                          step="1"
                          min="0"
                          value={inputs.failureRatePercent}
                          onChange={(e) =>
                            setInputs((prev) => ({
                              ...prev,
                              failureRatePercent: Math.max(0, parseFloat(e.target.value) || 0)
                            }))
                          }
                          className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                          Printer Price ({sym})
                        </label>
                        <input
                          type="number"
                          step="10"
                          min="100"
                          value={inputs.printerPurchasePrice}
                          onChange={(e) =>
                            setInputs((prev) => ({
                              ...prev,
                              printerPurchasePrice: Math.max(0, parseFloat(e.target.value) || 0)
                            }))
                          }
                          className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                          Custom Smart-Plug Watts
                        </label>
                        <input
                          type="number"
                          placeholder={`${Math.round(report.effectiveAverageWatts)}W auto`}
                          value={inputs.customAverageWatts ?? ''}
                          onChange={(e) => {
                            const val = e.target.value.trim();
                            setInputs((prev) => ({
                              ...prev,
                              customAverageWatts: val === '' ? null : Math.max(10, parseFloat(val) || 0)
                            }));
                          }}
                          className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* RIGHT SIDE (7 Columns): Clear Visual Cost Receipt + 3D Model Picture + PDF Export */}
          <div className="lg:col-span-7 space-y-6">
            {/* MAIN VISUAL RECEIPT CARD */}
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-5 pb-5 border-b border-slate-200 dark:border-slate-800">
                {/* Left: 3D Model Picture + Total Cost */}
                <div className="flex items-center gap-4">
                  {/* Model Picture Box */}
                  <div className="relative group shrink-0">
                    {gcodeData.thumbnailBase64 ? (
                      <img
                        src={gcodeData.thumbnailBase64}
                        alt={gcodeData.fileName}
                        referrerPolicy="no-referrer"
                        className="w-24 h-24 sm:w-28 sm:h-28 rounded-xl object-contain bg-slate-900 border border-slate-300 dark:border-slate-700 shadow-xs"
                      />
                    ) : (
                      <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-xl bg-slate-900 border border-slate-700 flex items-center justify-center text-xs text-slate-400">
                        No Preview
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => customImageInputRef.current?.click()}
                      className="mt-1.5 w-full py-1 px-2 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-[10px] font-medium text-slate-600 dark:text-slate-300 flex items-center justify-center gap-1 cursor-pointer"
                      title="Upload custom photo or slicer screenshot"
                    >
                      <ImageIcon className="w-3 h-3" />
                      <span>Change Photo</span>
                    </button>
                  </div>

                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                      Total True Cost For This Print
                    </span>
                    <div className="mt-1 flex items-baseline gap-3">
                      <span className="text-4xl sm:text-5xl font-bold tracking-tight font-mono tabular-nums text-slate-900 dark:text-white">
                        {sym}{report.totalManufacturingCost.toFixed(2)}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-1">
                      {sym}{(report.totalManufacturingCost / report.printHours).toFixed(2)}/hr · {formatDuration(gcodeData.printTimeSeconds)} · {gcodeData.filamentWeightGrams}g
                    </div>
                  </div>
                </div>

                {/* Right: Export PDF to Desktop "Cost" Folder Button + Copy Receipt */}
                <div className="flex flex-col sm:flex-row md:flex-col gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleExportCostPdf}
                    disabled={isExportingPdf}
                    className="px-4 py-2.5 text-xs font-bold rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <FileText className="w-4 h-4" />
                    <span>
                      {costFolderName
                        ? `Save PDF to "${costFolderName}" Folder`
                        : 'Export PDF to "Cost" Folder'}
                    </span>
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSelectCostOutputFolder}
                      className="flex-1 px-3 py-1.5 text-[11px] font-medium rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-center cursor-pointer"
                    >
                      {costFolderName ? `Folder: ${costFolderName}` : 'Set "Cost" Folder'}
                    </button>
                    <button
                      type="button"
                      onClick={handleCopyBreakdown}
                      className="flex-1 px-3 py-1.5 text-[11px] font-medium rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-center cursor-pointer"
                    >
                      {copiedSummary ? 'Copied!' : 'Copy Text'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Visual Equation: 3 Plain-English Cost Pillars */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 py-5">
                {/* Pillar 1: Filament */}
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800">
                  <div className="flex items-center justify-between text-xs font-semibold text-blue-600 dark:text-blue-400">
                    <span>1. Filament Used</span>
                    <span className="font-mono tabular-nums">{filamentSharePct.toFixed(0)}%</span>
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
                    {sym}{report.totalFilamentCost.toFixed(2)}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
                    <strong className="text-slate-700 dark:text-slate-300 font-mono">{report.totalFilamentGrams.toFixed(2)}g</strong> total ({gcodeData.filamentLengthMeters}m) at{' '}
                    <strong className="text-slate-700 dark:text-slate-300 font-mono">{sym}{inputs.spoolPrice}/kg</strong>
                    {gcodeData.flushedFilamentGrams + gcodeData.towerFilamentGrams > 0 && (
                      <> (includes {gcodeData.flushedFilamentGrams.toFixed(2)}g flushed & {gcodeData.towerFilamentGrams.toFixed(2)}g tower)</>
                    )}.
                  </p>
                </div>

                {/* Pillar 2: Electricity */}
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800">
                  <div className="flex items-center justify-between text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                    <span>2. Electricity</span>
                    <span className="font-mono tabular-nums">{electricitySharePct.toFixed(0)}%</span>
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
                    {sym}{report.electricityCost.toFixed(2)}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
                    Running for <strong className="text-slate-700 dark:text-slate-300 font-mono">{formatDuration(gcodeData.printTimeSeconds)}</strong> at ~{Math.round(report.effectiveAverageWatts)}W uses <strong className="text-slate-700 dark:text-slate-300 font-mono">{report.totalKwh.toFixed(2)} kWh</strong> of electricity.
                  </p>
                </div>

                {/* Pillar 3: Wear & Tear */}
                <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/30">
                  <div className="flex items-center justify-between text-xs font-semibold text-amber-600 dark:text-amber-400">
                    <span>3. Consumable Wear</span>
                    <span className="font-mono tabular-nums">{wearSharePct.toFixed(0)}%</span>
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400 mt-1">
                    {sym}{report.totalWearAndDepreciationCost.toFixed(2)}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
                    <strong className="text-slate-700 dark:text-slate-300 font-mono">{sym}{report.consumableWearCost.toFixed(2)}</strong> in real consumables ({sym}{hourlyConsumableWearRate.toFixed(3)}/hr across hotend, PEI plate, gears, filter & wiper)
                    {inputs.includeMachineDepreciation && (
                      <> + <strong className="text-slate-700 dark:text-slate-300 font-mono">{sym}{report.machineDepreciationCost.toFixed(2)}</strong> machine depreciation</>
                    )}.
                  </p>
                </div>
              </div>

              {/* Color-Coded Cost Bar */}
              <div className="pt-2">
                <div className="h-3 w-full rounded-full overflow-hidden flex bg-slate-100 dark:bg-slate-800">
                  <div
                    style={{ width: `${filamentSharePct}%` }}
                    className="bg-blue-500 transition-all"
                    title={`Filament: ${sym}${report.totalFilamentCost.toFixed(2)}`}
                  />
                  <div
                    style={{ width: `${electricitySharePct}%` }}
                    className="bg-emerald-500 transition-all"
                    title={`Electricity: ${sym}${report.electricityCost.toFixed(2)}`}
                  />
                  <div
                    style={{ width: `${wearSharePct}%` }}
                    className="bg-amber-500 transition-all"
                    title={`Consumable Wear: ${sym}${report.totalWearAndDepreciationCost.toFixed(2)}`}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400 mt-2">
                  <div className="flex items-center gap-4">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-xs bg-blue-500 inline-block" />
                      Filament ({sym}{report.totalFilamentCost.toFixed(2)})
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500 inline-block" />
                      Electricity ({sym}{report.electricityCost.toFixed(2)})
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-xs bg-amber-500 inline-block" />
                      Consumable Wear ({sym}{report.totalWearAndDepreciationCost.toFixed(2)})
                    </span>
                  </div>
                </div>
              </div>
            </section>

            {/* SUB-NAVIGATION TABS FOR WEAR BREAKDOWN VS PART EDITOR VS G-CODE DETAILS */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setActiveSection('summary')}
                  className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    activeSection === 'summary'
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  Part-by-Part Wear Breakdown
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSection('wear-editor')}
                  className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    activeSection === 'wear-editor'
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  Edit Part Prices & Lifespans
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSection('gcode-details')}
                  className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    activeSection === 'gcode-details'
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  Full Slicer & G-Code Info
                </button>
              </div>
            </div>

            {/* VIEW 1: INTUITIVE PART-BY-PART WEAR BREAKDOWN */}
            {activeSection === 'summary' && (
              <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-5">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">
                      Real-World Consumables Used by This Print ({sym}{report.consumableWearCost.toFixed(2)} total)
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      No double-counting: tracks the 5 actual wear consumables on your Elegoo CC2 over this{' '}
                      <strong className="text-slate-700 dark:text-slate-200">{formatDuration(gcodeData.printTimeSeconds)}</strong> print:
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveSection('wear-editor')}
                    className="text-xs font-semibold text-amber-600 dark:text-amber-400 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Change part prices →
                  </button>
                </div>

                <div className="space-y-3">
                  {report.componentBreakdowns.map((item) => {
                    const printsUntilReplacement = Math.max(
                      1,
                      Math.round(100 / Math.max(0.0001, item.lifeConsumedPercent))
                    );

                    return (
                      <div
                        key={item.component.id}
                        className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/50"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div>
                            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                              {item.component.name}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                              Replacement cost: <span className="font-mono">{sym}{item.component.replacementCost.toFixed(2)}</span> every{' '}
                              <span className="font-mono">{Math.round(item.effectiveLifespanHours)} hrs</span>{' '}
                              (<span className="font-mono">{sym}{item.costPerHour.toFixed(3)}/hr</span>)
                              {inputs.isAbrasiveMaterial && item.component.abrasiveMultiplier > 1 && (
                                <span className="text-amber-600 dark:text-amber-400">
                                  {' '}· {item.component.abrasiveMultiplier}× faster wear from abrasive filament
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="sm:text-right shrink-0">
                            <div className="text-base font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">
                              {sym}{item.costForThisPrint.toFixed(3)}
                            </div>
                            <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                              ~{printsUntilReplacement.toLocaleString()} prints like this per replacement
                            </div>
                          </div>
                        </div>

                        <div className="mt-3 flex items-center gap-3">
                          <div className="flex-1 h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                            <div
                              style={{ width: `${Math.min(100, Math.max(1.5, item.lifeConsumedPercent * 5))}%` }}
                              className="h-full bg-amber-500 rounded-full"
                            />
                          </div>
                          <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 w-24 text-right">
                            {item.lifeConsumedPercent.toFixed(2)}% life used
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* VIEW 2: EDITABLE WEAR & TEAR PART PRICES & LIFESPANS */}
            {activeSection === 'wear-editor' && (
              <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Customize Elegoo CC2 Consumable Prices & Lifespans
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Change any replacement cost or hour lifespan below to match what you pay for parts
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs">
                      <button
                        type="button"
                        onClick={() => handleSwitchHotendReplacementMode('assembly')}
                        className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                          isCompleteHotendMode
                            ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-semibold shadow-xs'
                            : 'text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        Full Hotend ({sym}24)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSwitchHotendReplacementMode('nozzle-tip')}
                        className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                          !isCompleteHotendMode
                            ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-semibold shadow-xs'
                            : 'text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        Nozzle Tip Only ({sym}3.50)
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={handleResetWearDefaults}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1.5 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reset</span>
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs sm:text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 bg-slate-50/60 dark:bg-slate-950/40">
                        <th className="py-2.5 px-4 font-medium">Part Name</th>
                        <th className="py-2.5 px-3 font-medium text-right">Part Price ({sym})</th>
                        <th className="py-2.5 px-3 font-medium text-right">Normal Life (Hrs)</th>
                        <th className="py-2.5 px-4 font-medium text-right">Cost This Print</th>
                        <th className="py-2.5 px-3 font-medium text-center">Remove</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800/70">
                      {report.componentBreakdowns.map((row) => (
                        <tr
                          key={row.component.id}
                          className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                        >
                          <td className="py-3 px-4">
                            <div className="font-medium text-slate-900 dark:text-slate-100">
                              {row.component.name}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                              {row.component.notes}
                            </div>
                          </td>
                          <td className="py-3 px-3 text-right">
                            <input
                              type="number"
                              step="0.5"
                              min="0.5"
                              value={row.component.replacementCost}
                              onChange={(e) =>
                                handleUpdateWearComponent(
                                  row.component.id,
                                  'replacementCost',
                                  parseFloat(e.target.value) || 1
                                )
                              }
                              className="w-20 px-2 py-1 text-right text-xs font-mono tabular-nums rounded bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                            />
                          </td>
                          <td className="py-3 px-3 text-right">
                            <input
                              type="number"
                              step="50"
                              min="20"
                              value={row.component.lifespanHours}
                              onChange={(e) =>
                                handleUpdateWearComponent(
                                  row.component.id,
                                  'lifespanHours',
                                  parseFloat(e.target.value) || 100
                                )
                              }
                              className="w-20 px-2 py-1 text-right text-xs font-mono tabular-nums rounded bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                            />
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-amber-600 dark:text-amber-400">
                            {sym}{row.costForThisPrint.toFixed(3)}
                          </td>
                          <td className="py-3 px-3 text-center">
                            <button
                              type="button"
                              onClick={() => handleDeleteWearComponent(row.component.id)}
                              className="p-1.5 text-slate-400 hover:text-rose-500 transition-colors cursor-pointer"
                              title="Remove part"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <form
                  onSubmit={handleAddWearComponent}
                  className="p-4 bg-slate-50/70 dark:bg-slate-950/50 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-end gap-3"
                >
                  <div className="flex-1 min-w-[180px]">
                    <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                      Add Another Part (e.g. Glue Stick, Timing Belt, Cooling Fan)
                    </label>
                    <input
                      type="text"
                      placeholder="Part name..."
                      value={newPartName}
                      onChange={(e) => setNewPartName(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
                    />
                  </div>
                  <div className="w-24">
                    <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                      Cost ({sym})
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      min="0.5"
                      value={newPartCost}
                      onChange={(e) => setNewPartCost(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
                    />
                  </div>
                  <div className="w-28">
                    <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                      Lifespan (Hrs)
                    </label>
                    <input
                      type="number"
                      step="25"
                      min="10"
                      value={newPartHours}
                      onChange={(e) => setNewPartHours(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
                    />
                  </div>
                  <button
                    type="submit"
                    className="px-3.5 py-1.5 text-xs font-semibold text-slate-950 bg-amber-500 hover:bg-amber-400 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Part</span>
                  </button>
                </form>
              </section>
            )}

            {/* VIEW 3: FULL SLICER & G-CODE TECHNICAL DETAILS */}
            {activeSection === 'gcode-details' && (
              <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">
                    All Parameters Extracted From Your G-Code File
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Complete slicer metadata read from <span className="font-mono">{gcodeData.fileName}</span>:
                  </p>
                </div>

                {gcodeData.filamentSlots.length > 0 && (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                    <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                      <span>Filament Spool Breakdown (ElegooSlicer Table)</span>
                      <span>Filament Changes: {gcodeData.filamentChangeCount}</span>
                    </div>
                    <table className="w-full text-left border-collapse text-xs font-mono tabular-nums">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 bg-slate-50/40 dark:bg-slate-950/30">
                          <th className="py-2 px-4">Filament</th>
                          <th className="py-2 px-3">Type</th>
                          <th className="py-2 px-3 text-right">Length</th>
                          <th className="py-2 px-3 text-right">Total Weight</th>
                          <th className="py-2 px-4 text-right">Cost (@ {sym}{inputs.spoolPrice}/kg)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800/70">
                        {gcodeData.filamentSlots.map((slot) => (
                          <tr key={slot.slotNumber}>
                            <td className="py-2.5 px-4 flex items-center gap-2 font-sans font-medium text-slate-900 dark:text-white">
                              <span
                                className="w-3 h-3 rounded-xs border border-slate-400/50 shrink-0"
                                style={{ backgroundColor: slot.colorHex }}
                              />
                              <span>
                                #{slot.slotNumber} {slot.settingName}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">{slot.type}</td>
                            <td className="py-2.5 px-3 text-right">{slot.lengthMeters.toFixed(2)} m</td>
                            <td className="py-2.5 px-3 text-right font-semibold">{slot.weightGrams.toFixed(2)} g</td>
                            <td className="py-2.5 px-4 text-right text-blue-600 dark:text-blue-400 font-semibold">
                              {sym}{((slot.weightGrams / inputs.spoolWeightGrams) * inputs.spoolPrice).toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-xs text-slate-500 dark:text-slate-400">Printer & Nozzle</div>
                    <div className="text-sm font-bold text-slate-900 dark:text-white mt-1 truncate">
                      {gcodeData.printerModel} ({gcodeData.nozzleDiameterMm}mm)
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                      {gcodeData.printProfileName}
                    </div>
                  </div>

                  <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-xs text-slate-500 dark:text-slate-400">Time Breakdown</div>
                    <div className="text-sm font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
                      Total: {formatDuration(gcodeData.printTimeSeconds)}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                      Model: {formatDuration(gcodeData.modelPrintTimeSeconds)} · Prep: {formatDuration(gcodeData.prepareTimeSeconds)}
                    </div>
                  </div>

                  <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-xs text-slate-500 dark:text-slate-400">Model vs Flush/Tower</div>
                    <div className="text-sm font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
                      Model: {gcodeData.modelFilamentGrams.toFixed(2)}g
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                      Flush: {gcodeData.flushedFilamentGrams.toFixed(2)}g · Tower: {gcodeData.towerFilamentGrams.toFixed(2)}g
                    </div>
                  </div>

                  <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-xs text-slate-500 dark:text-slate-400">Layer & Line Width</div>
                    <div className="text-sm font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
                      {gcodeData.layerHeightMm}mm ({gcodeData.totalLayers} layers)
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                      1st Layer: {gcodeData.firstLayerHeightMm}mm · Width: {gcodeData.lineWidthMm}mm
                    </div>
                  </div>

                  <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-xs text-slate-500 dark:text-slate-400">Walls & Infill</div>
                    <div className="text-sm font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
                      {gcodeData.wallLoops} Walls · {gcodeData.sparseInfillDensity} Infill
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                      Supports: {gcodeData.supportEnabled ? 'Enabled' : 'None'}
                    </div>
                  </div>

                  <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-xs text-slate-500 dark:text-slate-400">Temperatures & Flow</div>
                    <div className="text-sm font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
                      {gcodeData.nozzleTempC}°C / {gcodeData.bedTempC}°C
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                      Max Flow: {gcodeData.maxVolumetricSpeed} mm³/s
                    </div>
                  </div>
                </div>
              </section>
            )}
          </div>
        </div>
      </main>

      {/* Desktop PWA & Standalone Offline App Modal */}
      {showDesktopGuideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                100% Offline Windows Desktop App & Folder Setup
              </h3>
              <button
                type="button"
                onClick={() => setShowDesktopGuideModal(false)}
                className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
              >
                Close
              </button>
            </div>

            <div className="space-y-3 text-xs sm:text-sm text-slate-600 dark:text-slate-300">
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-2.5">
                <div className="font-bold text-emerald-600 dark:text-emerald-400">
                  Option A (Recommended): 100% Local Offline Desktop App (Zero Cloud Server)
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  Download both files below into a folder on your PC (e.g. on your Desktop). Double-click <strong>Elegoo_CC2_Offline_Launcher.bat</strong> to open the app in a standalone Windows desktop window running 100% off your hard drive — no internet or cloud server ever needed, and full live folder watching + direct PDF saving to <code className="font-mono">Desktop\Cost</code> remain enabled:
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <a
                    href="/Elegoo_CC2_Cost_Calculator_Offline.html"
                    download="Elegoo_CC2_Cost_Calculator_Offline.html"
                    className="px-3.5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs flex items-center gap-1.5 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>1. Download Offline App (.html)</span>
                  </a>
                  <a
                    href="/Elegoo_CC2_Offline_Launcher.bat"
                    download="Elegoo_CC2_Offline_Launcher.bat"
                    className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 font-semibold text-xs flex items-center gap-1.5 transition-colors"
                  >
                    <MonitorDown className="w-3.5 h-3.5 text-amber-400" />
                    <span>2. Download Windows Window Launcher (.bat)</span>
                  </a>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <div className="font-semibold text-slate-900 dark:text-white mb-1">
                  Link Your Desktop "Cost" Folder & ElegooSlicer Folder
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Use <strong>1. Connect G-Code Input Folder</strong> to watch your ElegooSlicer export folder, and <strong>2. Link Desktop "Cost" PDF Folder</strong> to automatically save <code className="font-mono">&lt;PrintName&gt;_Cost_Report.pdf</code> straight into your Desktop <code className="font-mono">Cost</code> folder.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <div className="font-semibold text-slate-900 dark:text-white mb-1">
                  Option B: Install Browser PWA Shortcut
                </div>
                {isInstallable ? (
                  <button
                    type="button"
                    onClick={install}
                    className="mt-1.5 px-4 py-2 text-xs font-semibold text-slate-950 bg-amber-500 hover:bg-amber-400 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <MonitorDown className="w-3.5 h-3.5" />
                    <span>Click Here to Install Browser PWA</span>
                  </button>
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    In Chrome, click the <strong>3 dots menu (⋮)</strong> at the top-right → <strong>Cast, save, and share</strong> → <strong>Install page as app...</strong>
                  </p>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDesktopGuideModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-950 bg-amber-500 hover:bg-amber-400 rounded-lg transition-colors cursor-pointer"
              >
                Got It
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
