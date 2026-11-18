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
  FileText,
  Image as ImageIcon,
  Layers,
  Search,
  Eye,
  Bookmark,
  Link as LinkIcon,
  X,
  AlertCircle,
  Camera,
  ArrowLeft
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
import { parse3mfFile } from './utils/threemfParser';
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
import { generateAndSavePrintCostPdf, generateAndSaveBatchCostPdf } from './utils/pdfExporter';
import {
  getAllSavedModels,
  saveModelToLibrary,
  deleteModelFromLibrary,
  clearAllSavedModels,
  updateModelThumbnailInLibrary
} from './utils/modelLibraryStorage';
import { fetchImageAsBase64, fileToBase64 } from './utils/imageUtils';
import { usePWAInstall } from './hooks/usePWAInstall';
import { BatchPrintItem, CalculationInputs, ParsedGcodeData, SavedModelItem, WearComponent } from './types';

const STORAGE_KEY_INPUTS = 'elegoo_cc2_user_inputs_v4';
const STORAGE_KEY_WEAR = 'elegoo_cc2_wear_components_v2';

export default function App() {
  const [darkMode, setDarkMode] = useState<boolean>(true);
  const [activeSection, setActiveSection] = useState<'summary' | 'model-library' | 'wear-editor' | 'gcode-details'>('summary');
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

  const [showAdvancedSettings, setShowAdvancedSettings] = useState<boolean>(false);
  const [copiedSummary, setCopiedSummary] = useState<boolean>(false);
  const [selectedPlateId, setSelectedPlateId] = useState<string>('all');
  const [isParsingFile, setIsParsingFile] = useState<boolean>(false);

  // Slicer & Live State
  const [isCurrentSliceSaved, setIsCurrentSliceSaved] = useState<boolean>(false);
  const [isSlicerConnected, setIsSlicerConnected] = useState<boolean>(false);
  const [isScanningSlicer, setIsScanningSlicer] = useState<boolean>(false);
  const [lastSliceTimestamp, setLastSliceTimestamp] = useState<number | null>(null);

  // Desktop "Cost" PDF Output Folder State
  const [costDirHandle, setCostDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [costFolderName, setCostFolderName] = useState<string>('');
  const [pdfExportToast, setPdfExportToast] = useState<string>('');
  const [isExportingPdf, setIsExportingPdf] = useState<boolean>(false);
  const [pdfDocType, setPdfDocType] = useState<'workshop' | 'quote'>('workshop');

  // Multi-Print Batch Queue State
  const [showBatchModal, setShowBatchModal] = useState<boolean>(false);
  const [batchQueue, setBatchQueue] = useState<BatchPrintItem[]>(() => {
    try {
      const saved = localStorage.getItem('elegoo_cc2_batch_queue_v1');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('elegoo_cc2_batch_queue_v1', JSON.stringify(batchQueue));
    } catch {
      // ignore
    }
  }, [batchQueue]);

  // Saved Models Library State
  const [savedModels, setSavedModels] = useState<SavedModelItem[]>([]);
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(new Set());
  const [librarySearchQuery, setLibrarySearchQuery] = useState<string>('');
  const [libraryFormatFilter, setLibraryFormatFilter] = useState<'all' | '3mf' | 'gcode'>('all');
  const [isExportingModelId, setIsExportingModelId] = useState<string | null>(null);

  // Thumbnail Link & Custom Photo Modal State
  const [showThumbnailModal, setShowThumbnailModal] = useState<boolean>(false);
  const [thumbnailTargetModelId, setThumbnailTargetModelId] = useState<string | null>(null); // null = active print, string = library item id
  const [thumbnailUrlInput, setThumbnailUrlInput] = useState<string>('');
  const [thumbnailWorkingDataUrl, setThumbnailWorkingDataUrl] = useState<string | null>(null);
  const [isLoadingThumbnailUrl, setIsLoadingThumbnailUrl] = useState<boolean>(false);
  const [thumbnailModalError, setThumbnailModalError] = useState<string | null>(null);

  // Load Saved Models from IndexedDB on startup
  useEffect(() => {
    let isMounted = true;
    const loadLibrary = async () => {
      try {
        let models = await getAllSavedModels();
        // If library is totally empty on first use, save initial preset model so user has something
        if (models.length === 0) {
          const initItem = await saveModelToLibrary(gcodeData, 'Kit Card Winter House');
          models = [initItem];
        }
        if (isMounted) {
          setSavedModels(models);
        }
      } catch (err) {
        console.error('Failed to load saved models library:', err);
      }
    };
    loadLibrary();
    return () => {
      isMounted = false;
    };
  }, []);

  const recordModelInLibrary = async (parsed: ParsedGcodeData, title?: string) => {
    try {
      const saved = await saveModelToLibrary(parsed, title);
      setSavedModels((prev) => {
        const withoutThis = prev.filter(
          (m) => m.id !== saved.id && m.fileName.toLowerCase() !== saved.fileName.toLowerCase()
        );
        return [saved, ...withoutThis];
      });
      return saved;
    } catch (err) {
      console.error('Failed to save model to library:', err);
      return null;
    }
  };

  const [newPartName, setNewPartName] = useState<string>('');
  const [newPartCost, setNewPartCost] = useState<string>('12.00');
  const [newPartHours, setNewPartHours] = useState<string>('1000');

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const customImageInputRef = useRef<HTMLInputElement | null>(null);

  const { isInIframe } = usePWAInstall();

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [darkMode]);

  // Check IndexedDB on mount for previously connected Desktop Cost PDF folder
  useEffect(() => {
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

  const displayedGcodeData = useMemo(() => {
    if (!gcodeData.plates || gcodeData.plates.length <= 1 || selectedPlateId === 'all') {
      return gcodeData;
    }
    const foundPlate = gcodeData.plates.find((p) => p.id === selectedPlateId);
    if (!foundPlate) return gcodeData;
    return {
      ...foundPlate.gcodeData,
      plates: gcodeData.plates,
      is3mf: true
    };
  }, [gcodeData, selectedPlateId]);

  const report = useMemo(() => {
    return calculatePrintEconomics(displayedGcodeData, inputs, activePowerProfile, wearComponents);
  }, [displayedGcodeData, inputs, activePowerProfile, wearComponents]);

  // Auto-fills heating mode and abrasive setting from parsed G-code WITHOUT overwriting the user's spool price or electricity rate!
  const applyParsedGcodeToApp = useCallback((parsed: ParsedGcodeData, autoSave = false) => {
    setGcodeData(parsed);
    setSelectedPlateId('all');
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

    if (autoSave) {
      recordModelInLibrary(parsed);
    }
  }, []);

  const handleSaveCurrentSliceToLibrary = async () => {
    try {
      const saved = await recordModelInLibrary(displayedGcodeData);
      if (saved) {
        setIsCurrentSliceSaved(true);
        setPdfExportToast(`Saved "${saved.displayName}" to Library!`);
        setTimeout(() => setPdfExportToast(''), 3000);
      }
    } catch (err) {
      console.error('Failed to save model to library:', err);
    }
  };

  const loadSliceGcode = useCallback(
    (gcodeText: string, filename: string) => {
      try {
        const parsed = parseGcodeFile(gcodeText, filename || 'OrcaSlicer_Plate.gcode');
        applyParsedGcodeToApp(parsed, false);
        setIsCurrentSliceSaved(false);
        setLastSliceTimestamp(Date.now());
        setIsSlicerConnected(true);
      } catch (err) {
        console.error('Failed to parse sliced G-code:', err);
      }
    },
    [applyParsedGcodeToApp]
  );

  const scanForLatestSlice = useCallback(async () => {
    setIsScanningSlicer(true);
    // 1. Try window.orca message request
    // @ts-ignore
    if (window.orca?.postMessage) {
      try {
        // @ts-ignore
        window.orca.postMessage({ type: 'scan' });
      } catch {}
    }
    // 2. Try HTTP API endpoint (works in dev mode or local server)
    try {
      const res = await fetch('/api/latest-slice');
      if (res.ok) {
        const data = await res.json();
        const slice = data?.slice || data;
        const gcode = slice?.gcode || slice?.content;
        if (gcode) {
          loadSliceGcode(gcode, slice.filename || slice.path);
          setPdfExportToast('Loaded latest sliced plate from OrcaSlicer!');
          setTimeout(() => setPdfExportToast(''), 3000);
        }
      }
    } catch {
      // Ignore if endpoint unreachable
    } finally {
      setIsScanningSlicer(false);
    }
  }, [loadSliceGcode]);

  useEffect(() => {
    // 0. Check window.__INITIAL_ORCA_SLICE__ injected directly by Python plugin
    const initSlice = (window as any).__INITIAL_ORCA_SLICE__;
    if (initSlice) {
      const gcode = initSlice.gcode || initSlice.content;
      if (gcode) {
        loadSliceGcode(gcode, initSlice.filename || initSlice.path);
      }
    }

    const handleSliceMsg = (data: any) => {
      if (!data) return;
      const slice = data.slice || (data.type === 'sliced' || data.type === 'slice_finished' || data.type === 'latest_slice' ? data : null);
      if (slice) {
        const gcode = slice.gcode || slice.content;
        if (gcode) {
          loadSliceGcode(gcode, slice.filename || slice.path);
        }
      }
    };

    // 1. Check window.orca (OrcaSlicer native webview integration)
    // @ts-ignore
    if (window.orca) {
      setIsSlicerConnected(true);
      // @ts-ignore
      if (typeof window.orca.onMessage === 'function') {
        // @ts-ignore
        window.orca.onMessage(handleSliceMsg);
      } else {
        // @ts-ignore
        window.orca.onMessage = handleSliceMsg;
      }
      // @ts-ignore
      window.orca.postMessage?.({ type: 'ready' });
    }

    // 2. Window postMessage listener (iframe bridge fallback)
    const handleWindowMsg = (event: MessageEvent) => {
      handleSliceMsg(event.data);
    };
    window.addEventListener('message', handleWindowMsg);

    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ fromApp: true, type: 'ready' }, '*');
      }
    } catch {}

    // 3. Scan immediately for latest slice on startup
    scanForLatestSlice();

    return () => {
      window.removeEventListener('message', handleWindowMsg);
    };
  }, [loadSliceGcode, scanForLatestSlice]);

  const toggleModelSelection = (id: string) => {
    setSelectedModelIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAllFilteredModels = (modelsToSelect: SavedModelItem[]) => {
    setSelectedModelIds(new Set(modelsToSelect.map((m) => m.id)));
  };

  const handleDeselectAllModels = () => {
    setSelectedModelIds(new Set());
  };

  const handleExportSelectedCostListPdf = async () => {
    const selectedList = savedModels.filter((m) => selectedModelIds.has(m.id));
    if (selectedList.length === 0) {
      alert('Please select at least one model from the library to export.');
      return;
    }

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
      if (!targetHandle && typeof win.showDirectoryPicker === 'function' && !isInIframe) {
        targetHandle = await handleSelectCostOutputFolder();
      }

      const activePowerProfile =
        ELEGOO_CC2_POWER_PROFILES.find((p) => p.id === inputs.powerProfileId) ||
        ELEGOO_CC2_POWER_PROFILES[0];

      const batchItems: BatchPrintItem[] = selectedList.map((m) => ({
        id: m.id,
        name: m.displayName,
        fileName: m.fileName,
        plateName: m.displayName,
        thumbnailBase64: m.thumbnailBase64,
        gcodeData: m.parsedData,
        quantity: 1,
        addedAt: Date.now()
      }));

      const result = await generateAndSaveBatchCostPdf(
        batchItems,
        inputs,
        activePowerProfile,
        wearComponents,
        targetHandle,
        {
          docType: pdfDocType,
          batchTitle: `Print Cost List & Commercial Quotation (${selectedList.length} Models)`
        }
      );

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

  const handleFileUpload = async (file: File) => {
    setIsParsingFile(true);
    try {
      if (file.name.toLowerCase().endsWith('.3mf')) {
        const parsed = await parse3mfFile(file, file.name);
        setSelectedPresetId('');
        setSelectedPlateId('all');
        applyParsedGcodeToApp(parsed);
      } else {
        const content = await file.text();
        const parsed = parseGcodeFile(content, file.name, file.size);
        setSelectedPresetId('');
        setSelectedPlateId('all');
        applyParsedGcodeToApp(parsed);
      }
    } catch (err) {
      console.error('Failed to parse file:', err);
      alert('Unable to parse file. Please verify it is a valid G-code or 3MF archive.');
    } finally {
      setIsParsingFile(false);
    }
  };

  const handleFilesUpload = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;
    if (files.length === 1) {
      await handleFileUpload(files[0]);
      return;
    }

    setIsParsingFile(true);
    const newBatchItems: BatchPrintItem[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.name.toLowerCase().endsWith('.3mf')) {
          const parsed = await parse3mfFile(file, file.name);
          await recordModelInLibrary(parsed);
          if (parsed.plates && parsed.plates.length > 1) {
            // Add each plate
            for (const pl of parsed.plates) {
              newBatchItems.push({
                id: `batch_${Date.now()}_${i}_${pl.id}`,
                name: `${file.name} [${pl.name}]`,
                fileName: file.name,
                plateName: pl.name,
                thumbnailBase64: pl.thumbnailBase64 || parsed.thumbnailBase64,
                gcodeData: pl.gcodeData,
                quantity: 1,
                addedAt: Date.now()
              });
            }
          } else {
            newBatchItems.push({
              id: `batch_${Date.now()}_${i}`,
              name: file.name,
              fileName: file.name,
              thumbnailBase64: parsed.thumbnailBase64,
              gcodeData: parsed,
              quantity: 1,
              addedAt: Date.now()
            });
          }
        } else {
          const content = await file.text();
          const parsed = parseGcodeFile(content, file.name, file.size);
          await recordModelInLibrary(parsed);
          newBatchItems.push({
            id: `batch_${Date.now()}_${i}`,
            name: file.name,
            fileName: file.name,
            thumbnailBase64: parsed.thumbnailBase64,
            gcodeData: parsed,
            quantity: 1,
            addedAt: Date.now()
          });
        }
      }

      setBatchQueue((prev) => [...prev, ...newBatchItems]);
      setShowBatchModal(true);
      setPdfExportToast(`Added ${newBatchItems.length} prints to your Multi-Print Batch Queue!`);
      setTimeout(() => setPdfExportToast(''), 4500);
    } catch (err) {
      console.error('Failed to parse multi-files:', err);
      alert('One or more files could not be parsed.');
    } finally {
      setIsParsingFile(false);
    }
  };

  const handleOpenThumbnailModal = (targetModelId: string | null = null) => {
    setThumbnailTargetModelId(targetModelId);
    setThumbnailUrlInput('');
    setThumbnailModalError(null);
    setIsLoadingThumbnailUrl(false);

    if (targetModelId) {
      const found = savedModels.find((m) => m.id === targetModelId);
      setThumbnailWorkingDataUrl(found?.thumbnailBase64 || null);
    } else {
      setThumbnailWorkingDataUrl(displayedGcodeData.thumbnailBase64 || null);
    }
    setShowThumbnailModal(true);
  };

  const handleFetchThumbnailUrlPreview = async () => {
    if (!thumbnailUrlInput.trim()) {
      setThumbnailModalError('Please paste an image URL first');
      return;
    }
    setIsLoadingThumbnailUrl(true);
    setThumbnailModalError(null);
    try {
      const dataUrl = await fetchImageAsBase64(thumbnailUrlInput.trim());
      setThumbnailWorkingDataUrl(dataUrl);
    } catch (err: any) {
      setThumbnailModalError(err.message || 'Failed to load image from link');
    } finally {
      setIsLoadingThumbnailUrl(false);
    }
  };

  const handleSaveThumbnailToModel = async () => {
    let finalDataUrl = thumbnailWorkingDataUrl;

    if (thumbnailUrlInput.trim() && !finalDataUrl) {
      setIsLoadingThumbnailUrl(true);
      try {
        finalDataUrl = await fetchImageAsBase64(thumbnailUrlInput.trim());
        setThumbnailWorkingDataUrl(finalDataUrl);
      } catch (err: any) {
        setThumbnailModalError(err.message || 'Failed to fetch image from URL');
        setIsLoadingThumbnailUrl(false);
        return;
      }
      setIsLoadingThumbnailUrl(false);
    }

    if (!finalDataUrl) {
      setThumbnailModalError('Please paste an image link or upload a photo first');
      return;
    }

    try {
      if (thumbnailTargetModelId) {
        const updated = await updateModelThumbnailInLibrary(thumbnailTargetModelId, finalDataUrl);
        if (updated) {
          setSavedModels((prev) =>
            prev.map((m) => (m.id === thumbnailTargetModelId ? { ...m, thumbnailBase64: finalDataUrl } : m))
          );
        }
        if (gcodeData.fileName === updated?.fileName) {
          setGcodeData((prev) => ({
            ...prev,
            thumbnailBase64: finalDataUrl
          }));
        }
        setPdfExportToast('Saved new thumbnail to saved model!');
      } else {
        setGcodeData((prev) => ({
          ...prev,
          thumbnailBase64: finalDataUrl
        }));
        await updateModelThumbnailInLibrary(gcodeData.fileName, finalDataUrl);
        setSavedModels((prev) =>
          prev.map((m) =>
            m.fileName.toLowerCase() === gcodeData.fileName.toLowerCase()
              ? { ...m, thumbnailBase64: finalDataUrl }
              : m
          )
        );
        setPdfExportToast('Saved new thumbnail to model!');
      }
      setTimeout(() => setPdfExportToast(''), 3000);
      setShowThumbnailModal(false);
    } catch {
      setThumbnailModalError('Failed to save thumbnail');
    }
  };

  const handleRemoveThumbnail = async () => {
    if (thumbnailTargetModelId) {
      await updateModelThumbnailInLibrary(thumbnailTargetModelId, '');
      setSavedModels((prev) =>
        prev.map((m) => (m.id === thumbnailTargetModelId ? { ...m, thumbnailBase64: null } : m))
      );
    } else {
      setGcodeData((prev) => ({
        ...prev,
        thumbnailBase64: null
      }));
      await updateModelThumbnailInLibrary(gcodeData.fileName, '');
      setSavedModels((prev) =>
        prev.map((m) =>
          m.fileName.toLowerCase() === gcodeData.fileName.toLowerCase()
            ? { ...m, thumbnailBase64: null }
            : m
        )
      );
    }
    setShowThumbnailModal(false);
    setPdfExportToast('Thumbnail removed.');
    setTimeout(() => setPdfExportToast(''), 2500);
  };

  const handleCustomModelImageUpload = async (file: File) => {
    try {
      const dataUrl = await fileToBase64(file);
      setThumbnailWorkingDataUrl(dataUrl);
      setThumbnailModalError(null);
      if (!showThumbnailModal) {
        setGcodeData((prev) => ({ ...prev, thumbnailBase64: dataUrl }));
        await updateModelThumbnailInLibrary(gcodeData.fileName, dataUrl);
        setSavedModels((prev) =>
          prev.map((m) =>
            m.fileName.toLowerCase() === gcodeData.fileName.toLowerCase()
              ? { ...m, thumbnailBase64: dataUrl }
              : m
          )
        );
        setPdfExportToast('Photo updated & saved to model!');
        setTimeout(() => setPdfExportToast(''), 3000);
      }
    } catch {
      setThumbnailModalError('Failed to load image file');
    }
  };

  const handleSelectSamplePreset = (presetId: string) => {
    const found = SAMPLE_GCODE_PRESETS.find((p) => p.id === presetId);
    if (!found) return;
    setSelectedPresetId(presetId);
    setSelectedPlateId('all');
    if (found.plates && found.plates.length > 0) {
      const parsedBase = parseGcodeFile(found.gcodeContent, found.fileName);
      const combined: ParsedGcodeData = {
        ...parsedBase,
        fileName: `${found.fileName} (${found.plates.length} Printbeds)`,
        plates: found.plates,
        is3mf: true
      };
      applyParsedGcodeToApp(combined);
    } else {
      const parsed = parseGcodeFile(found.gcodeContent, found.fileName);
      applyParsedGcodeToApp(parsed);
    }
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

      const result = await generateAndSavePrintCostPdf(displayedGcodeData, inputs, report, targetHandle, {
        docType: pdfDocType
      });
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

  // Multi-Print Batch Handlers
  const handleAddToBatch = (itemData: ParsedGcodeData, customTitle?: string) => {
    const newItem: BatchPrintItem = {
      id: `batch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: customTitle || itemData.fileName,
      fileName: itemData.fileName,
      thumbnailBase64: itemData.thumbnailBase64,
      gcodeData: itemData,
      quantity: 1,
      addedAt: Date.now()
    };
    setBatchQueue((prev) => [...prev, newItem]);
    setPdfExportToast(`Added "${newItem.name}" to Multi-Print Batch!`);
    setTimeout(() => setPdfExportToast(''), 3500);
  };

  const handleAddAllPlatesToBatch = () => {
    if (!gcodeData.plates || gcodeData.plates.length === 0) {
      handleAddToBatch(gcodeData);
      return;
    }
    const newItems: BatchPrintItem[] = gcodeData.plates.map((plate) => ({
      id: `batch_${Date.now()}_${plate.id}_${Math.random().toString(36).slice(2, 6)}`,
      name: `${gcodeData.fileName} [${plate.name}]`,
      fileName: gcodeData.fileName,
      plateName: plate.name,
      thumbnailBase64: plate.thumbnailBase64 || gcodeData.thumbnailBase64,
      gcodeData: plate.gcodeData,
      quantity: 1,
      addedAt: Date.now()
    }));
    setBatchQueue((prev) => [...prev, ...newItems]);
    setPdfExportToast(`Added all ${newItems.length} plates to Multi-Print Batch!`);
    setTimeout(() => setPdfExportToast(''), 4000);
  };

  const handleUpdateBatchQuantity = (id: string, delta: number) => {
    setBatchQueue((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, quantity: Math.max(1, item.quantity + delta) } : item
      )
    );
  };

  const handleSetBatchQuantity = (id: string, qty: number) => {
    setBatchQueue((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, quantity: Math.max(1, qty) } : item
      )
    );
  };

  const handleRemoveFromBatch = (id: string) => {
    setBatchQueue((prev) => prev.filter((item) => item.id !== id));
  };

  const handleClearBatch = () => {
    setBatchQueue([]);
  };

  const handleExportBatchPdf = async () => {
    if (batchQueue.length === 0) return;
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
      if (!targetHandle && typeof win.showDirectoryPicker === 'function' && !isInIframe) {
        targetHandle = await handleSelectCostOutputFolder();
      }

      const activePowerProfile =
        ELEGOO_CC2_POWER_PROFILES.find((p) => p.id === inputs.powerProfileId) ||
        ELEGOO_CC2_POWER_PROFILES[0];
      const result = await generateAndSaveBatchCostPdf(
        batchQueue,
        inputs,
        activePowerProfile,
        wearComponents,
        targetHandle,
        {
          docType: pdfDocType,
          batchTitle: `Production Batch (${batchQueue.length} Print Jobs)`
        }
      );
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

  const handleExportAllPlatesDirectPdf = async () => {
    if (!gcodeData.plates || gcodeData.plates.length === 0) {
      handleExportCostPdf();
      return;
    }
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
      if (!targetHandle && typeof win.showDirectoryPicker === 'function' && !isInIframe) {
        targetHandle = await handleSelectCostOutputFolder();
      }

      const activePowerProfile =
        ELEGOO_CC2_POWER_PROFILES.find((p) => p.id === inputs.powerProfileId) ||
        ELEGOO_CC2_POWER_PROFILES[0];
      const plateItems: BatchPrintItem[] = gcodeData.plates.map((plate) => ({
        id: `direct_${plate.id}`,
        name: `${gcodeData.fileName} [${plate.name}]`,
        fileName: gcodeData.fileName,
        plateName: plate.name,
        thumbnailBase64: plate.thumbnailBase64 || gcodeData.thumbnailBase64,
        gcodeData: plate.gcodeData,
        quantity: 1,
        addedAt: Date.now()
      }));
      const result = await generateAndSaveBatchCostPdf(
        plateItems,
        inputs,
        activePowerProfile,
        wearComponents,
        targetHandle,
        {
          docType: pdfDocType,
          batchTitle: `${gcodeData.fileName} (${plateItems.length} Beds)`
        }
      );
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

  // Saved Models Library Handlers
  const handleLoadModelFromLibrary = (model: SavedModelItem) => {
    applyParsedGcodeToApp(model.parsedData);
    setSelectedPresetId('');
    setSelectedPlateId('all');
    setActiveSection('summary');
    setPdfExportToast(`Loaded "${model.displayName}" as active print!`);
    setTimeout(() => setPdfExportToast(''), 3000);
  };

  const handleExportModelDirectPdf = async (model: SavedModelItem, docType: 'workshop' | 'quote' = pdfDocType) => {
    setIsExportingModelId(model.id);
    try {
      let targetHandle = costDirHandle;
      const win = window as unknown as {
        showDirectoryPicker?: (opts?: {
          id?: string;
          mode?: 'read' | 'readwrite';
          startIn?: string;
        }) => Promise<FileSystemDirectoryHandle>;
      };
      if (!targetHandle && typeof win.showDirectoryPicker === 'function' && !isInIframe) {
        targetHandle = await handleSelectCostOutputFolder();
      }

      const activePowerProfile =
        ELEGOO_CC2_POWER_PROFILES.find((p) => p.id === inputs.powerProfileId) ||
        ELEGOO_CC2_POWER_PROFILES[0];
      const modelReport = calculatePrintEconomics(
        model.parsedData,
        inputs,
        activePowerProfile,
        wearComponents
      );
      const result = await generateAndSavePrintCostPdf(
        model.parsedData,
        inputs,
        modelReport,
        targetHandle,
        { docType }
      );
      if (result.savedToFolder) {
        setPdfExportToast(`Saved "${result.fileName}" to your "${result.folderName}" folder!`);
      } else {
        setPdfExportToast(`Downloaded "${result.fileName}"!`);
      }
      setTimeout(() => setPdfExportToast(''), 4500);
    } finally {
      setIsExportingModelId(null);
    }
  };

  const handleDeleteModelFromLibraryHandler = async (id: string) => {
    await deleteModelFromLibrary(id);
    setSavedModels((prev) => prev.filter((m) => m.id !== id));
    setPdfExportToast('Removed model from library.');
    setTimeout(() => setPdfExportToast(''), 2500);
  };

  const handleClearAllModelsHandler = async () => {
    if (!confirm('Are you sure you want to remove all saved models from your library?')) return;
    await clearAllSavedModels();
    setSavedModels([]);
    setPdfExportToast('Model library cleared.');
    setTimeout(() => setPdfExportToast(''), 2500);
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

  const filteredModels = useMemo(() => {
    return savedModels.filter((model) => {
      const q = librarySearchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        model.fileName.toLowerCase().includes(q) ||
        model.displayName.toLowerCase().includes(q) ||
        (model.parsedData.filamentType && model.parsedData.filamentType.toLowerCase().includes(q));

      const matchesFormat =
        libraryFormatFilter === 'all'
          ? true
          : libraryFormatFilter === '3mf'
          ? model.format === '3mf'
          : model.format === 'gcode';

      return matchesSearch && matchesFormat;
    });
  }, [savedModels, librarySearchQuery, libraryFormatFilter]);

  const handleReturnBack = () => {
    if (activeSection !== 'summary') {
      setActiveSection('summary');
      return;
    }

    try {
      // @ts-ignore
      if (window.orca?.postMessage) {
        // @ts-ignore
        window.orca.postMessage({ type: 'switch_view', view: 'prepare' });
        // @ts-ignore
        window.orca.postMessage({ type: 'switch_to_prepare' });
      }
    } catch {}

    setPdfExportToast('💡 To return to the 3D Plate, click the [Prepare] tab on the top bar of OrcaSlicer.');
    setTimeout(() => setPdfExportToast(null), 5000);
  };

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors">
      {/* PDF Saved Toast Notification */}
      {pdfExportToast && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2.5 rounded-xl bg-emerald-600 px-4 py-3 text-xs sm:text-sm font-semibold text-white shadow-xl">
          <Check className="w-4 h-4 shrink-0" />
          <span>{pdfExportToast}</span>
        </div>
      )}




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
      <header className="sticky top-0 z-30 w-full max-w-full bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800 px-3 sm:px-6 py-2 sm:py-2.5 transition-colors">
        <div className="max-w-[1360px] mx-auto flex flex-col xl:flex-row xl:items-center justify-between gap-2.5 xl:gap-4">
          {/* Top Row on < xl, Left side on >= xl: Brand and Action Buttons */}
          <div className="flex items-center justify-between gap-3 w-full xl:w-auto">
            <div className="flex items-center gap-2.5">
              {/* Prominent Back Button */}
              <button
                type="button"
                onClick={handleReturnBack}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-400 border border-amber-500/40 text-xs font-bold transition-all shadow-xs cursor-pointer group shrink-0"
                title={activeSection === 'summary' ? 'Return to OrcaSlicer 3D Prepare plate' : 'Back to Cost Summary'}
              >
                <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
                <span>{activeSection === 'summary' ? 'Back to Slicer' : 'Back to Summary'}</span>
              </button>

              <div className="w-7 h-7 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-500 font-bold text-xs shrink-0 shadow-xs">
                CC2
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <span className="text-sm sm:text-base font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap font-display">
                    Elegoo CC2 Cost & Wear Calculator
                  </span>
                  <span className="hidden sm:inline-flex px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                    OrcaSlicer Plugin
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-2">
                  <span>Spool: <strong className="font-mono text-slate-700 dark:text-slate-300">{sym}{inputs.spoolPrice}/kg</strong></span>
                  <span>·</span>
                  <span>Power: <strong className="font-mono text-slate-700 dark:text-slate-300">{sym}{inputs.electricityRatePerKwh}/kWh</strong></span>
                </div>
              </div>
            </div>

            {/* Action buttons (Batch + PDF + Dark mode) */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowBatchModal(true)}
                className={`px-2.5 sm:px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer shadow-xs ${
                  batchQueue.length > 0
                    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/40 hover:bg-amber-500/20'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:border-amber-500'
                }`}
              >
                <Layers className="w-3.5 h-3.5 text-amber-500" />
                <span className="hidden sm:inline">Batch Queue</span>
                <span className="sm:hidden">Batch</span>
                {batchQueue.length > 0 && (
                  <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500 text-slate-950">
                    {batchQueue.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={handleExportCostPdf}
                disabled={isExportingPdf}
                className="px-2.5 sm:px-3.5 py-1.5 text-xs font-semibold text-slate-950 bg-amber-500 hover:bg-amber-400 rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <FileText className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">
                  {costFolderName ? `Save PDF to "${costFolderName}"` : 'Export PDF'}
                </span>
                <span className="sm:hidden">PDF</span>
              </button>

              <button
                type="button"
                onClick={() => setDarkMode(!darkMode)}
                className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
                title="Toggle Theme"
              >
                {darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Navigation Tabs Bar */}
          <nav className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm font-medium text-slate-600 dark:text-slate-400 overflow-x-auto no-scrollbar py-0.5 max-w-full">
            <button
              type="button"
              onClick={() => setActiveSection('summary')}
              className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer px-2.5 py-1 rounded-md ${
                activeSection === 'summary'
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold'
                  : 'hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              Cost Summary
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('model-library')}
              className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 flex items-center gap-1 cursor-pointer px-2.5 py-1 rounded-md ${
                activeSection === 'model-library'
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold'
                  : 'hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Bookmark className="w-3.5 h-3.5 text-amber-500" />
              <span>Saved Models</span>
              {savedModels.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-500 border border-amber-500/30">
                  {savedModels.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('wear-editor')}
              className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer px-2.5 py-1 rounded-md ${
                activeSection === 'wear-editor'
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold'
                  : 'hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              Rates & Lifespans
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('gcode-details')}
              className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer px-2.5 py-1 rounded-md ${
                activeSection === 'gcode-details'
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold'
                  : 'hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              G-Code Specs
            </button>
          </nav>
        </div>
      </header>

      <main id="top" className="w-full max-w-[1360px] mx-auto px-3 sm:px-6 py-4 sm:py-6">
        {activeSection === 'model-library' ? (
          <div className="space-y-6">
            {/* Library Header Bar */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 shadow-xs">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Bookmark className="w-5 h-5 text-amber-500" />
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                      Saved Models & Cost Library
                    </h2>
                    <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                      {savedModels.length} {savedModels.length === 1 ? 'Model' : 'Models'}
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1">
                    All imported .3MF projects and .GCODE prints are automatically saved locally. Generate instant cost sheet PDFs or reload any print at any time.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {selectedModelIds.size > 0 && (
                    <button
                      type="button"
                      onClick={handleExportSelectedCostListPdf}
                      disabled={isExportingPdf}
                      className="px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-md"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Export Print Cost List PDF ({selectedModelIds.size})</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setActiveSection('summary')}
                    className="px-3.5 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-semibold text-xs transition-colors cursor-pointer"
                  >
                    Back to Calculator
                  </button>
                  {savedModels.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearAllModelsHandler}
                      className="px-3 py-2 rounded-lg text-rose-500 hover:bg-rose-500/10 text-xs font-semibold transition-colors cursor-pointer"
                      title="Clear all saved models from library"
                    >
                      Clear Library
                    </button>
                  )}
                </div>
              </div>

              {/* Search & Filter Toolbar + Multi-Selection Controls */}
              <div className="mt-5 pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-col md:flex-row items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                  <div className="relative w-full sm:w-64">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={librarySearchQuery}
                      onChange={(e) => setLibrarySearchQuery(e.target.value)}
                      placeholder="Search models, materials..."
                      className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                  </div>

                  {filteredModels.length > 0 && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleSelectAllFilteredModels(filteredModels)}
                        className="px-2.5 py-1 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 cursor-pointer transition-colors"
                      >
                        Select All ({filteredModels.length})
                      </button>
                      {selectedModelIds.size > 0 && (
                        <button
                          type="button"
                          onClick={handleDeselectAllModels}
                          className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer transition-colors"
                        >
                          Deselect All
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1.5 w-full md:w-auto justify-end">
                  {(['all', '3mf', 'gcode'] as const).map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => setLibraryFormatFilter(fmt)}
                      className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                        libraryFormatFilter === fmt
                          ? 'bg-amber-500 text-slate-950'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      {fmt === 'all'
                        ? `All (${savedModels.length})`
                        : fmt === '3mf'
                        ? `3MF (${savedModels.filter((m) => m.format === '3mf').length})`
                        : `G-Code (${savedModels.filter((m) => m.format === 'gcode').length})`}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Grid of Saved Models */}
            {filteredModels.length === 0 ? (
              <div className="bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-12 text-center">
                <Bookmark className="w-10 h-10 text-slate-400 mx-auto mb-3 opacity-60" />
                <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">
                  {savedModels.length === 0 ? 'Your Model Library is Empty' : 'No matching models found'}
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto mb-4">
                  {savedModels.length === 0
                    ? 'Drop any .3MF or .GCODE file into the calculator and it will automatically be saved here so you can generate cost PDFs or reload it anytime.'
                    : 'Try clearing your search query or format filter.'}
                </p>
                {savedModels.length === 0 && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold text-xs inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <Upload className="w-4 h-4" />
                    <span>Upload First Model</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {filteredModels.map((item) => {
                  const activePowerProfile =
                    ELEGOO_CC2_POWER_PROFILES.find((p) => p.id === inputs.powerProfileId) ||
                    ELEGOO_CC2_POWER_PROFILES[0];
                  const itemReport = calculatePrintEconomics(
                    item.parsedData,
                    inputs,
                    activePowerProfile,
                    wearComponents
                  );
                  const isExporting = isExportingModelId === item.id;
                  const isMultiPlate = (item.parsedData.plates && item.parsedData.plates.length > 1) || (item.platesCount ?? 1) > 1;
                  const isSelected = selectedModelIds.has(item.id);

                  return (
                    <div
                      key={item.id}
                      className={`bg-white dark:bg-slate-900 border rounded-xl p-4 flex flex-col justify-between transition-all shadow-xs group ${
                        isSelected
                          ? 'border-amber-500 ring-2 ring-amber-500/40 bg-amber-500/[0.02]'
                          : 'border-slate-200 dark:border-slate-800 hover:border-amber-500/50'
                      }`}
                    >
                      <div>
                        {/* Thumbnail & Format Badges */}
                        <div className="relative w-full h-36 bg-slate-100 dark:bg-slate-950 rounded-lg overflow-hidden flex items-center justify-center border border-slate-200 dark:border-slate-800 mb-3">
                          {item.thumbnailBase64 ? (
                            <img
                              src={item.thumbnailBase64}
                              alt={item.displayName}
                              className="w-full h-full object-contain p-2"
                            />
                          ) : (
                            <div className="text-center p-4">
                              <Layers className="w-8 h-8 text-slate-400 mx-auto mb-1 opacity-50" />
                              <span className="text-[11px] text-slate-400 font-mono">No Preview</span>
                            </div>
                          )}

                          {/* Multi-Select Checkbox Pill */}
                          <label
                            onClick={(e) => e.stopPropagation()}
                            className={`absolute top-2 right-2 z-10 flex items-center gap-1.5 px-2 py-1 rounded-md backdrop-blur-xs border transition-colors cursor-pointer shadow-xs ${
                              isSelected
                                ? 'bg-amber-500 text-slate-950 font-bold border-amber-600'
                                : 'bg-slate-900/80 text-white border-slate-700 hover:border-amber-500'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleModelSelection(item.id)}
                              className="w-3.5 h-3.5 accent-slate-950 dark:accent-amber-500 rounded cursor-pointer"
                            />
                            <span className="text-[10px] font-semibold">{isSelected ? 'Selected' : 'Select'}</span>
                          </label>

                          <div className="absolute top-2 left-2 flex items-center gap-1">
                            <span
                              className={`px-2 py-0.5 text-[10px] font-extrabold rounded-md shadow-xs ${
                                item.format === '3mf'
                                  ? 'bg-cyan-500 text-slate-950'
                                  : 'bg-emerald-500 text-slate-950'
                              }`}
                            >
                              .{item.format.toUpperCase()}
                            </span>
                            {isMultiPlate && (
                              <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-amber-500/90 text-slate-950 shadow-xs">
                                {item.parsedData.plates?.length || item.platesCount || 1} Beds
                              </span>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenThumbnailModal(item.id);
                            }}
                            className="absolute bottom-2 left-2 px-2 py-0.5 text-[10px] font-semibold rounded-md bg-slate-900/80 hover:bg-amber-500 hover:text-slate-950 text-white backdrop-blur-xs flex items-center gap-1 transition-colors cursor-pointer shadow-xs"
                            title="Add link or change thumbnail picture"
                          >
                            <LinkIcon className="w-3 h-3 text-amber-400" />
                            <span>Link Photo</span>
                          </button>

                          <div className="absolute bottom-2 right-2 px-2 py-0.5 text-[10px] font-bold rounded-md bg-slate-900/80 text-white backdrop-blur-xs">
                            {formatDuration(item.parsedData.printTimeSeconds)}
                          </div>
                        </div>

                        {/* Name & Details */}
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div>
                            <h4
                              className="text-sm font-bold text-slate-900 dark:text-white line-clamp-1 group-hover:text-amber-500 transition-colors"
                              title={item.displayName}
                            >
                              {item.displayName}
                            </h4>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate">
                              {item.fileName}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteModelFromLibraryHandler(item.id)}
                            className="p-1 text-slate-400 hover:text-rose-500 rounded-md transition-colors cursor-pointer shrink-0"
                            title="Delete model from library"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Specs Chips */}
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-400 mb-3">
                          <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 font-mono">
                            {item.parsedData.filamentWeightGrams.toFixed(1)}g
                          </span>
                          <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800">
                            {item.parsedData.filamentType || 'PLA'}
                          </span>
                          <span className="text-[10px] text-slate-400 ml-auto">
                            {new Date(item.importedAt).toLocaleDateString()}
                          </span>
                        </div>

                        {/* Dynamic Cost Badges */}
                        <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950/80 border border-slate-200/80 dark:border-slate-800/80 mb-3 space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-500 dark:text-slate-400">Total True Cost:</span>
                            <span className="font-bold text-slate-900 dark:text-white font-mono">
                              {sym}{itemReport.totalManufacturingCost.toFixed(2)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-amber-600 dark:text-amber-400 font-medium">Quote Price ({inputs.markupMultiplier}x markup):</span>
                            <span className="font-bold text-amber-600 dark:text-amber-400 font-mono">
                              {sym}{itemReport.suggestedQuotePrice.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Card Action Buttons */}
                      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                        <button
                          type="button"
                          onClick={() => handleExportModelDirectPdf(item, 'quote')}
                          disabled={isExporting}
                          className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                          title="Generate and export cost sheet PDF"
                        >
                          <FileText className={`w-3.5 h-3.5 ${isExporting ? 'animate-spin' : ''}`} />
                          <span>{isExporting ? 'Exporting...' : 'Export PDF'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleLoadModelFromLibrary(item)}
                          className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                          title="Load this model into the active calculator"
                        >
                          <Eye className="w-3.5 h-3.5 text-cyan-400" />
                          <span>Load Model</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* LEFT SIDE (5 Columns): Simple 3-Step Guided Inputs */}
          <div className="lg:col-span-5 space-y-5 order-2 lg:order-1">
            {/* STEP 1: ACTIVE ORCASLICER SLICE */}
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs">
              <div className="flex items-center justify-between gap-2 mb-3.5">
                <div className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-emerald-500 text-slate-950 font-bold text-xs flex items-center justify-center shrink-0">
                    ⚡
                  </span>
                  <div>
                    <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <span>Active Slicer Plate</span>
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                      </span>
                    </h2>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={scanForLatestSlice}
                    disabled={isScanningSlicer}
                    className="px-2.5 py-1 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    title="Reload newest sliced plate from OrcaSlicer"
                  >
                    <RefreshCw className={`w-3 h-3 ${isScanningSlicer ? 'animate-spin' : ''}`} />
                    <span>Re-Scan</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveSection('model-library')}
                    className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <Bookmark className="w-3 h-3 text-amber-500" />
                    <span>Library ({savedModels.length})</span>
                  </button>
                </div>
              </div>

              {/* Active Slice Summary Card */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-600 dark:text-emerald-400 font-bold block">
                      OrcaSlicer Sliced Plate
                    </span>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate font-mono mt-0.5" title={displayedGcodeData.fileName}>
                      {displayedGcodeData.fileName}
                    </h3>
                  </div>
                  <span className="px-2 py-0.5 text-[11px] font-bold rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shrink-0 font-mono">
                    {displayedGcodeData.filamentType}
                  </span>
                </div>

                {/* Sliced Specs Pills */}
                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200 dark:border-slate-800 text-center font-mono">
                  <div className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80">
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 uppercase">Print Time</div>
                    <div className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                      {formatDuration(displayedGcodeData.printTimeSeconds)}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80">
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 uppercase">Filament</div>
                    <div className="text-xs sm:text-sm font-bold text-amber-600 dark:text-amber-400 mt-0.5">
                      {displayedGcodeData.filamentWeightGrams}g
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80">
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 uppercase">Nozzle / Bed</div>
                    <div className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                      {displayedGcodeData.nozzleTempC}° / {displayedGcodeData.bedTempC}°
                    </div>
                  </div>
                </div>

                {/* Multi-bed plate selector if 3MF project with multiple plates */}
                {gcodeData.plates && gcodeData.plates.length > 1 && (
                  <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                    <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1">
                      <Layers className="w-3.5 h-3.5 text-amber-500" />
                      <span>Select Printbed:</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => setSelectedPlateId('all')}
                        className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                          selectedPlateId === 'all'
                            ? 'bg-amber-500 text-slate-950 font-bold'
                            : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        All Beds ({gcodeData.plates.length})
                      </button>
                      {gcodeData.plates.map((pl) => (
                        <button
                          key={pl.id}
                          type="button"
                          onClick={() => setSelectedPlateId(pl.id)}
                          className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                            selectedPlateId === pl.id
                              ? 'bg-amber-500 text-slate-950 font-bold'
                              : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          {pl.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Multi-extruder slot breakdown */}
                {displayedGcodeData.filamentSlots.length > 0 && (
                  <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-1">
                    {displayedGcodeData.filamentSlots.map((slot) => (
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

                {/* Prominent Save to Library Choice Button */}
                <div className="pt-2">
                  {!isCurrentSliceSaved ? (
                    <button
                      type="button"
                      onClick={handleSaveCurrentSliceToLibrary}
                      className="w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-sm hover:shadow-amber-500/20 transition-all cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Save Current Slice to Library</span>
                    </button>
                  ) : (
                    <div className="w-full py-2 px-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 font-semibold text-xs flex items-center justify-center gap-2">
                      <Check className="w-4 h-4 text-emerald-500" />
                      <span>Saved in Library — Available for Multi-Model PDF Export</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Quick Presets Toggle for testing */}
              <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-1.5">
                  <span>Or test with a sample model:</span>
                </div>
                <div className="grid grid-cols-1 gap-1">
                  {SAMPLE_GCODE_PRESETS.slice(0, 2).map((preset) => {
                    const isSelected = selectedPresetId === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => handleSelectSamplePreset(preset.id)}
                        className={`text-left px-2.5 py-1.5 rounded-lg border text-xs transition-colors flex items-center justify-between gap-2 cursor-pointer ${
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
          <div className="lg:col-span-7 space-y-6 order-1 lg:order-2">
            {/* MULTI-PRINTBED 3MF PROJECT BANNER / SELECTOR */}
            {gcodeData.plates && gcodeData.plates.length > 1 && (
              <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border border-amber-500/40 rounded-xl p-4 shadow-sm space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400">
                      <Layers className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-white flex items-center gap-2">
                        Multi-Printbed 3MF Project
                        <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                          {gcodeData.plates.length} Printbeds
                        </span>
                      </div>
                      <div className="text-xs text-slate-400">
                        Select a printbed to inspect individual costs, or view the entire batch
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleExportAllPlatesDirectPdf}
                      disabled={isExportingPdf}
                      className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 transition-colors flex items-center gap-1 cursor-pointer shadow-xs"
                    >
                      <FileText className="w-3 h-3" />
                      <span>Export All {gcodeData.plates.length} Beds PDF</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleAddAllPlatesToBatch}
                      className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-400 border border-amber-500/30 transition-colors flex items-center gap-1 cursor-pointer shadow-xs"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Add All Beds to Batch</span>
                    </button>
                    <div className="text-right text-xs font-mono text-slate-300 pl-1">
                      Total: <span className="font-bold text-amber-400">{formatDuration(gcodeData.printTimeSeconds)}</span> · <span className="font-bold text-emerald-400">{gcodeData.filamentWeightGrams.toFixed(1)}g</span>
                    </div>
                  </div>
                </div>

                {/* Printbed Tab Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {/* All Beds Option */}
                  <button
                    type="button"
                    onClick={() => setSelectedPlateId('all')}
                    className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                      selectedPlateId === 'all'
                        ? 'bg-amber-500/20 border-amber-500 text-white shadow-xs'
                        : 'bg-slate-950/60 border-slate-700/60 text-slate-300 hover:border-slate-500'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-bold">
                      <span>All Printbeds</span>
                      <span className="text-[10px] font-mono text-amber-400 font-normal">Combined</span>
                    </div>
                    <div className="text-[11px] font-mono text-slate-400 mt-1 flex items-center justify-between">
                      <span>{formatDuration(gcodeData.printTimeSeconds)}</span>
                      <span className="font-semibold text-emerald-400">{gcodeData.filamentWeightGrams.toFixed(1)}g</span>
                    </div>
                  </button>

                  {/* Individual Beds */}
                  {gcodeData.plates.map((plate) => {
                    const isSelected = selectedPlateId === plate.id;
                    return (
                      <button
                        key={plate.id}
                        type="button"
                        onClick={() => setSelectedPlateId(plate.id)}
                        className={`p-2 rounded-lg border text-left transition-all flex items-center gap-2 cursor-pointer ${
                          isSelected
                            ? 'bg-amber-500/20 border-amber-500 text-white shadow-xs'
                            : 'bg-slate-950/60 border-slate-700/60 text-slate-300 hover:border-slate-500'
                        }`}
                      >
                        {plate.thumbnailBase64 ? (
                          <img
                            src={plate.thumbnailBase64}
                            alt={plate.name}
                            className="w-8 h-8 rounded object-contain bg-slate-900 border border-slate-700 shrink-0"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0 text-[10px] font-bold text-amber-400 font-mono">
                            P{plate.index}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold truncate" title={plate.name}>
                            {plate.name}
                          </div>
                          <div className="text-[10px] font-mono text-slate-400 flex items-center justify-between">
                            <span>{formatDuration(plate.printTimeSeconds)}</span>
                            <span className="text-emerald-400">{plate.filamentWeightGrams.toFixed(1)}g</span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* MAIN VISUAL RECEIPT CARD */}
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-5 pb-5 border-b border-slate-200 dark:border-slate-800">
                {/* Left: 3D Model Picture + Total Cost */}
                <div className="flex items-center gap-4">
                  {/* Model Picture Box */}
                  <div className="relative group shrink-0">
                    {displayedGcodeData.thumbnailBase64 ? (
                      <img
                        src={displayedGcodeData.thumbnailBase64}
                        alt={displayedGcodeData.fileName}
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
                      onClick={() => handleOpenThumbnailModal(null)}
                      className="mt-1.5 w-full py-1 px-2 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-[10px] font-medium text-slate-600 dark:text-slate-300 flex items-center justify-center gap-1 cursor-pointer transition-colors"
                      title="Add web link or upload photo for model thumbnail"
                    >
                      <LinkIcon className="w-3 h-3 text-amber-500" />
                      <span>Change / Link Photo</span>
                    </button>
                  </div>

                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                      {selectedPlateId !== 'all'
                        ? `Cost for ${displayedGcodeData.fileName}`
                        : gcodeData.plates && gcodeData.plates.length > 1
                          ? `Total True Cost for All ${gcodeData.plates.length} Printbeds`
                          : 'Total True Cost For This Print'}
                    </span>
                    <div className="mt-1 flex items-baseline gap-3">
                      <span className="text-4xl sm:text-5xl font-bold tracking-tight font-mono tabular-nums text-slate-900 dark:text-white">
                        {sym}{report.totalManufacturingCost.toFixed(2)}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-1">
                      {sym}{(report.totalManufacturingCost / report.printHours).toFixed(2)}/hr · {formatDuration(displayedGcodeData.printTimeSeconds)} · {displayedGcodeData.filamentWeightGrams}g
                    </div>
                  </div>
                </div>

                {/* Right: Export PDF to Desktop "Cost" Folder Button + Copy Receipt */}
                <div className="flex flex-col sm:flex-row md:flex-col gap-2 shrink-0">
                  {/* PDF Document Type Toggle */}
                  <div className="flex rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 text-[11px] font-semibold border border-slate-200 dark:border-slate-700">
                    <button
                      type="button"
                      onClick={() => setPdfDocType('workshop')}
                      className={`flex-1 py-1 px-2.5 rounded-md transition-colors cursor-pointer text-center ${
                        pdfDocType === 'workshop'
                          ? 'bg-amber-500 text-slate-950 shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      Workshop Report
                    </button>
                    <button
                      type="button"
                      onClick={() => setPdfDocType('quote')}
                      className={`flex-1 py-1 px-2.5 rounded-md transition-colors cursor-pointer text-center ${
                        pdfDocType === 'quote'
                          ? 'bg-amber-500 text-slate-950 shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      Client Quote
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleExportCostPdf}
                    disabled={isExportingPdf}
                    className="px-4 py-2.5 text-xs font-bold rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <FileText className="w-4 h-4" />
                    <span>
                      {costFolderName
                        ? `Save ${pdfDocType === 'quote' ? 'Quotation' : 'Report'} to "${costFolderName}"`
                        : `Export ${pdfDocType === 'quote' ? 'Quotation' : 'Cost Report'} PDF`}
                    </span>
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleAddToBatch(displayedGcodeData)}
                      className="flex-1 py-1.5 px-2.5 text-[11px] font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 transition-colors flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5 text-amber-500" />
                      <span>Add to Batch</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowBatchModal(true)}
                      className={`flex-1 py-1.5 px-2.5 text-[11px] font-semibold rounded-lg border transition-colors flex items-center justify-center gap-1 cursor-pointer ${
                        batchQueue.length > 0
                          ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/40 hover:bg-amber-500/20'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:border-amber-500'
                      }`}
                    >
                      <Layers className="w-3.5 h-3.5 text-amber-500" />
                      <span>Batch ({batchQueue.length})</span>
                    </button>
                  </div>

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
                    <button
                      type="button"
                      onClick={() => setActiveSection('summary')}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30 text-xs font-semibold transition-colors cursor-pointer"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Back to Summary</span>
                    </button>
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
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">
                      All Parameters Extracted From Your G-Code File
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Complete slicer metadata read from <span className="font-mono">{gcodeData.fileName}</span>:
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveSection('summary')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30 text-xs font-semibold transition-colors cursor-pointer shrink-0 self-start sm:self-auto"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Back to Cost Summary</span>
                  </button>
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
      )}
    </main>

      {/* Model Thumbnail Picture & Web Link Modal */}
      {showThumbnailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Camera className="w-5 h-5 text-amber-500" />
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {thumbnailTargetModelId
                    ? `Set Thumbnail: ${savedModels.find((m) => m.id === thumbnailTargetModelId)?.displayName || 'Model'}`
                    : `Set Thumbnail: ${displayedGcodeData.fileName}`}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowThumbnailModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Live Preview Box */}
            <div className="flex flex-col items-center justify-center">
              <div className="relative w-48 h-48 rounded-xl bg-slate-100 dark:bg-slate-950 border-2 border-dashed border-slate-300 dark:border-slate-700 overflow-hidden flex items-center justify-center shadow-inner">
                {isLoadingThumbnailUrl ? (
                  <div className="flex flex-col items-center gap-2 p-4 text-center">
                    <RefreshCw className="w-8 h-8 text-amber-500 animate-spin" />
                    <span className="text-xs text-amber-500 font-medium">Fetching & converting image from link...</span>
                  </div>
                ) : thumbnailWorkingDataUrl ? (
                  <img
                    src={thumbnailWorkingDataUrl}
                    alt="Thumbnail Preview"
                    className="w-full h-full object-contain p-2"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-2 text-slate-400 p-4 text-center">
                    <ImageIcon className="w-10 h-10 opacity-40" />
                    <span className="text-xs font-medium">No Thumbnail Set</span>
                    <span className="text-[11px] text-slate-500">Paste an image link or upload a file below</span>
                  </div>
                )}
              </div>
            </div>

            {/* Method 1: Web Link / Image URL */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <LinkIcon className="w-3.5 h-3.5 text-amber-500" />
                <span>Image Web Link (URL)</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="url"
                  value={thumbnailUrlInput}
                  onChange={(e) => {
                    setThumbnailUrlInput(e.target.value);
                    if (thumbnailModalError) setThumbnailModalError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleFetchThumbnailUrlPreview();
                    }
                  }}
                  placeholder="https://... (MakerWorld, Printables, Google, Imgur...)"
                  className="flex-1 px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-amber-500 font-mono"
                />
                <button
                  type="button"
                  onClick={handleFetchThumbnailUrlPreview}
                  disabled={isLoadingThumbnailUrl || !thumbnailUrlInput.trim()}
                  className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 transition-colors shrink-0 cursor-pointer shadow-xs"
                >
                  {isLoadingThumbnailUrl ? 'Loading...' : 'Preview Link'}
                </button>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Works with any image URL. It will automatically download, convert to base64, and embed permanently into the model and exported PDFs.
              </p>
            </div>

            {/* Method 2: Upload File Alternative */}
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
              <span className="text-slate-500 dark:text-slate-400">Or choose a local photo:</span>
              <button
                type="button"
                onClick={() => customImageInputRef.current?.click()}
                className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5 text-amber-500" />
                <span>Upload Image File (.png, .jpg)</span>
              </button>
            </div>

            {/* Error Message */}
            {thumbnailModalError && (
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{thumbnailModalError}</span>
              </div>
            )}

            {/* Footer Buttons */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-slate-800">
              {thumbnailWorkingDataUrl ? (
                <button
                  type="button"
                  onClick={handleRemoveThumbnail}
                  className="text-xs text-rose-500 hover:text-rose-600 font-semibold cursor-pointer"
                >
                  Remove Thumbnail
                </button>
              ) : (
                <div />
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowThumbnailModal(false)}
                  className="px-3.5 py-1.5 text-xs font-semibold rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveThumbnailToModel}
                  disabled={isLoadingThumbnailUrl || (!thumbnailWorkingDataUrl && !thumbnailUrlInput.trim())}
                  className="px-4 py-2 text-xs font-bold rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 transition-colors cursor-pointer shadow-xs flex items-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Save to Model</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}



      {/* MULTI-PRINT BATCH QUEUE & QUOTATION MODAL */}
      {showBatchModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-4 sm:px-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50/70 dark:bg-slate-950/60">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-500/20 text-amber-500 shrink-0">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                      Multi-Print Production Batch
                    </h2>
                    <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-500 border border-amber-500/30">
                      {batchQueue.length} {batchQueue.length === 1 ? 'Job' : 'Jobs'} (
                      {batchQueue.reduce((acc, it) => acc + it.quantity, 0)} pcs)
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Combine multiple prints, plates, or separate files into one itemized PDF quotation or workshop report
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* PDF Type Toggle */}
                <div className="hidden sm:flex rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 text-[11px] font-semibold border border-slate-200 dark:border-slate-700">
                  <button
                    type="button"
                    onClick={() => setPdfDocType('workshop')}
                    className={`py-1 px-2.5 rounded-md transition-colors cursor-pointer text-center ${
                      pdfDocType === 'workshop'
                        ? 'bg-amber-500 text-slate-950 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Workshop Report
                  </button>
                  <button
                    type="button"
                    onClick={() => setPdfDocType('quote')}
                    className={`py-1 px-2.5 rounded-md transition-colors cursor-pointer text-center ${
                      pdfDocType === 'quote'
                        ? 'bg-amber-500 text-slate-950 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Client Quote
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setShowBatchModal(false)}
                  className="w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center transition-colors cursor-pointer text-sm font-bold"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Quick Actions Bar */}
            <div className="px-4 sm:px-6 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-100/50 dark:bg-slate-900/50 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleAddToBatch(displayedGcodeData)}
                  className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-amber-500 text-slate-800 dark:text-slate-200 font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 text-amber-500" />
                  <span>Add Active Print ({displayedGcodeData.fileName.slice(0, 16)}...)</span>
                </button>

                {gcodeData.plates && gcodeData.plates.length > 1 && (
                  <button
                    type="button"
                    onClick={handleAddAllPlatesToBatch}
                    className="px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>Add All {gcodeData.plates.length} Plates</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-amber-500 text-slate-700 dark:text-slate-300 font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5 text-slate-400" />
                  <span>Upload More Files (.gcode, .3mf)</span>
                </button>
              </div>

              {batchQueue.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearBatch}
                  className="text-rose-500 hover:text-rose-600 dark:hover:text-rose-400 font-medium flex items-center gap-1 transition-colors cursor-pointer text-xs"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear All</span>
                </button>
              )}
            </div>

            {/* Scrollable Items List */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3">
              {batchQueue.length === 0 ? (
                <div className="py-12 px-4 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                  <Layers className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
                  <h3 className="text-sm sm:text-base font-bold text-slate-800 dark:text-slate-200">
                    Your Multi-Print Batch is Empty
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto mt-1 leading-relaxed">
                    Add prints or plates to this queue, adjust order quantities, and generate an itemized consolidated PDF for your clients or workshop records.
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
                    <button
                      type="button"
                      onClick={() => handleAddToBatch(displayedGcodeData)}
                      className="px-3.5 py-2 text-xs font-bold rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 transition-colors cursor-pointer"
                    >
                      + Add Active Print to Batch
                    </button>
                    {gcodeData.plates && gcodeData.plates.length > 1 && (
                      <button
                        type="button"
                        onClick={handleAddAllPlatesToBatch}
                        className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 transition-colors cursor-pointer"
                      >
                        + Add All {gcodeData.plates.length} Plates from Project
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                batchQueue.map((item, idx) => {
                  const activePowerProfile =
                    ELEGOO_CC2_POWER_PROFILES.find((p) => p.id === inputs.powerProfileId) ||
                    ELEGOO_CC2_POWER_PROFILES[0];
                  const itemReport = calculatePrintEconomics(item.gcodeData, inputs, activePowerProfile, wearComponents);
                  const unitPrice = pdfDocType === 'quote' ? itemReport.suggestedQuotePrice : itemReport.totalManufacturingCost;
                  const itemTotalPrice = unitPrice * item.quantity;
                  const itemTotalTime = item.gcodeData.printTimeSeconds * item.quantity;
                  const itemTotalGrams = item.gcodeData.filamentWeightGrams * item.quantity;
                  const colorSlot = item.gcodeData.filamentSlots[0];

                  return (
                    <div
                      key={item.id}
                      className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 hover:border-amber-500/50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      {/* Left: Thumbnail & Name */}
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className="text-xs font-mono font-bold text-slate-400 w-5 shrink-0">
                          #{idx + 1}
                        </span>

                        <div className="w-12 h-12 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center overflow-hidden shrink-0">
                          {item.thumbnailBase64 ? (
                            <img
                              src={item.thumbnailBase64}
                              alt={item.name}
                              className="w-full h-full object-contain"
                            />
                          ) : (
                            <Layers className="w-5 h-5 text-slate-400" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">
                            {item.name}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                            {colorSlot ? (
                              <span className="inline-flex items-center gap-1">
                                <span
                                  className="w-2.5 h-2.5 rounded-full border border-slate-400"
                                  style={{ backgroundColor: colorSlot.colorHex }}
                                />
                                <span>{colorSlot.type}</span>
                              </span>
                            ) : (
                              <span>{item.gcodeData.filamentType || 'PLA'}</span>
                            )}
                            <span>·</span>
                            <span>{formatDuration(item.gcodeData.printTimeSeconds)} / ea</span>
                            <span>·</span>
                            <span>{item.gcodeData.filamentWeightGrams.toFixed(1)}g / ea</span>
                          </div>
                        </div>
                      </div>

                      {/* Middle: Quantity Stepper */}
                      <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                        <div className="flex items-center rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
                          <button
                            type="button"
                            onClick={() => handleUpdateBatchQuantity(item.id, -1)}
                            disabled={item.quantity <= 1}
                            className="px-2.5 py-1 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) => handleSetBatchQuantity(item.id, parseInt(e.target.value, 10) || 1)}
                            className="w-12 py-1 text-center font-mono text-xs font-bold bg-transparent border-0 focus:outline-hidden"
                          />
                          <button
                            type="button"
                            onClick={() => handleUpdateBatchQuantity(item.id, 1)}
                            className="px-2.5 py-1 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                          >
                            +
                          </button>
                        </div>

                        {/* Right: Subtotal & Delete */}
                        <div className="text-right min-w-[90px]">
                          <div className="text-xs sm:text-sm font-bold font-mono text-amber-600 dark:text-amber-400">
                            {sym}{itemTotalPrice.toFixed(2)}
                          </div>
                          <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                            {formatDuration(itemTotalTime)} · {itemTotalGrams.toFixed(1)}g
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleRemoveFromBatch(item.id)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer"
                          title="Remove item"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Sticky Summary & Export Footer */}
            {batchQueue.length > 0 && (() => {
              const activePowerProfile =
                ELEGOO_CC2_POWER_PROFILES.find((p) => p.id === inputs.powerProfileId) ||
                ELEGOO_CC2_POWER_PROFILES[0];
              const batchCalculations = batchQueue.map((item) => {
                const qty = Math.max(1, item.quantity);
                const rep = calculatePrintEconomics(item.gcodeData, inputs, activePowerProfile, wearComponents);
                const unitPrice = pdfDocType === 'quote' ? rep.suggestedQuotePrice : rep.totalManufacturingCost;
                return {
                  qty,
                  unitPrice,
                  totalPrice: unitPrice * qty,
                  totalTimeSecs: item.gcodeData.printTimeSeconds * qty,
                  totalWeightGrams: item.gcodeData.filamentWeightGrams * qty,
                  totalKwh: rep.totalKwh * qty
                };
              });
              const totalBatchPrice = batchCalculations.reduce((a, b) => a + b.totalPrice, 0);
              const totalBatchTimeSecs = batchCalculations.reduce((a, b) => a + b.totalTimeSecs, 0);
              const totalBatchWeightGrams = batchCalculations.reduce((a, b) => a + b.totalWeightGrams, 0);
              const totalBatchKwh = batchCalculations.reduce((a, b) => a + b.totalKwh, 0);
              const totalPartsCount = batchCalculations.reduce((a, b) => a + b.qty, 0);

              return (
                <div className="p-4 sm:px-6 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/80 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                      <div>
                        <span className="text-slate-500 dark:text-slate-400 block text-[10px]">Total Parts</span>
                        <strong className="font-mono text-slate-900 dark:text-white">{totalPartsCount} pcs</strong>
                      </div>
                      <div>
                        <span className="text-slate-500 dark:text-slate-400 block text-[10px]">Total Print Run</span>
                        <strong className="font-mono text-slate-900 dark:text-white">{formatDuration(totalBatchTimeSecs)}</strong>
                      </div>
                      <div>
                        <span className="text-slate-500 dark:text-slate-400 block text-[10px]">Total Material</span>
                        <strong className="font-mono text-slate-900 dark:text-white">{totalBatchWeightGrams.toFixed(1)}g</strong>
                      </div>
                      <div>
                        <span className="text-slate-500 dark:text-slate-400 block text-[10px]">Electrical Draw</span>
                        <strong className="font-mono text-slate-900 dark:text-white">{totalBatchKwh.toFixed(2)} kWh</strong>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-[10px] font-bold text-amber-600 dark:text-amber-400 tracking-wider">
                        {pdfDocType === 'quote' ? 'TOTAL CLIENT QUOTATION' : 'TOTAL PRODUCTION COST'}
                      </div>
                      <div className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                        {sym}{totalBatchPrice.toFixed(2)}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {costFolderName ? (
                        <span>Saving directly to: <strong className="text-slate-700 dark:text-slate-200 font-mono">Desktop\{costFolderName}</strong></span>
                      ) : (
                        <span>PDF will download directly to your device</span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowBatchModal(false)}
                        className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                      >
                        Back to App
                      </button>

                      <button
                        type="button"
                        onClick={handleExportBatchPdf}
                        disabled={isExportingPdf}
                        className="px-5 py-2 text-xs font-bold rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
                      >
                        <FileText className="w-4 h-4" />
                        <span>
                          {isExportingPdf
                            ? 'Generating PDF...'
                            : costFolderName
                            ? `Save ${pdfDocType === 'quote' ? 'Batch Quote' : 'Batch Report'} to "${costFolderName}"`
                            : `Export Multi-Print ${pdfDocType === 'quote' ? 'Quotation' : 'Report'} PDF`}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
