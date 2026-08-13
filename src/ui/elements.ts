function required<T extends Element>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Expected #${id} to exist in the document`);
  return el as unknown as T;
}

export function getElements() {
  return {
    // Header
    themeToggle: required<HTMLButtonElement>("themeToggle"),
    oauthSigninBtn: required<HTMLButtonElement>("oauthSigninBtn"),
    oauthSignedIn: required<HTMLDivElement>("oauthSignedIn"),
    oauthAvatar: required<HTMLSpanElement>("oauthAvatar"),
    oauthUsername: required<HTMLElement>("oauthUsername"),
    oauthSignoutBtn: required<HTMLButtonElement>("oauthSignoutBtn"),

    // Load card
    srcSeg: required<HTMLDivElement>("srcSeg"),
    localPane: required<HTMLDivElement>("localPane"),
    emberPane: required<HTMLDivElement>("emberPane"),
    emberUrl: required<HTMLInputElement>("emberUrl"),
    emberLoadBtn: required<HTMLButtonElement>("emberLoadBtn"),
    dropzone: required<HTMLDivElement>("dropzone"),
    browseVideoBtn: required<HTMLButtonElement>("browseVideoBtn"),
    sampleBtn: required<HTMLButtonElement>("sampleBtn"),
    videoFile: required<HTMLInputElement>("videoFile"),
    slpFile: required<HTMLInputElement>("slpFile"),
    slpToggle: required<HTMLInputElement>("slpToggle"),

    // Player
    playerCard: required<HTMLElement>("playerCard"),
    modeSeg: required<HTMLDivElement>("modeSeg"),
    stage: required<HTMLDivElement>("stage"),
    emptyStage: required<HTMLDivElement>("emptyStage"),
    view: required<HTMLCanvasElement>("view"),
    overlayInfo: required<HTMLDivElement>("overlayInfo"),
    selbar: required<HTMLDivElement>("selbar"),
    selfill: required<HTMLDivElement>("selfill"),
    inHandle: required<HTMLDivElement>("inHandle"),
    outHandle: required<HTMLDivElement>("outHandle"),
    playHandle: required<HTMLDivElement>("playHandle"),
    selRuler: required<HTMLDivElement>("selruler"),
    btnPrev: required<HTMLButtonElement>("btnPrev"),
    btnPlay: required<HTMLButtonElement>("btnPlay"),
    btnNext: required<HTMLButtonElement>("btnNext"),
    speedSeg: required<HTMLDivElement>("speedSeg"),
    inVal: required<HTMLInputElement>("inVal"),
    curVal: required<HTMLInputElement>("curVal"),
    outVal: required<HTMLInputElement>("outVal"),
    btnClearSel: required<HTMLButtonElement>("btnClearSel"),

    // SLEAP annotations card
    slpCard: required<HTMLElement>("slpCard"),
    slpDropzone: required<HTMLDivElement>("slpDropzone"),
    browseSlpBtn: required<HTMLButtonElement>("browseSlpBtn"),
    slpError: required<HTMLDivElement>("slpError"),
    slpErrorTitle: required<HTMLParagraphElement>("slpErrorTitle"),
    slpErrorList: required<HTMLUListElement>("slpErrorList"),
    slpWarning: required<HTMLDivElement>("slpWarning"),
    slpWarningTitle: required<HTMLParagraphElement>("slpWarningTitle"),
    slpWarningList: required<HTMLUListElement>("slpWarningList"),
    slpStatus: required<HTMLDivElement>("slpStatus"),
    slpBadge: required<HTMLSpanElement>("slpBadge"),
    showPose: required<HTMLInputElement>("showPose"),

    // Delivery card (Download / Upload)
    deliverSeg: required<HTMLDivElement>("deliverSeg"),
    selectionDescription: required<HTMLTextAreaElement>("selectionDescription"),
    uploadOriginalRow: required<HTMLLabelElement>("uploadOriginalRow"),
    uploadOriginal: required<HTMLInputElement>("uploadOriginal"),
    uploadOriginalNote: required<HTMLParagraphElement>("uploadOriginalNote"),
    downloadPane: required<HTMLDivElement>("downloadPane"),
    downloadHint: required<HTMLParagraphElement>("downloadHint"),
    downloadPreview: required<HTMLParagraphElement>("downloadPreview"),
    downloadPreviewName: required<HTMLElement>("downloadPreviewName"),
    btnDownload: required<HTMLButtonElement>("btnDownload"),
    downloadStatus: required<HTMLSpanElement>("downloadStatus"),

    // Upload destination
    uploadPane: required<HTMLDivElement>("uploadPane"),
    dandisetId: required<HTMLSelectElement>("dandisetId"),
    dandisetMessage: required<HTMLParagraphElement>("dandisetMessage"),
    dandisetSingle: required<HTMLParagraphElement>("dandisetSingle"),
    dandisetSingleText: required<HTMLSpanElement>("dandisetSingleText"),
    dandisetEmbargoError: required<HTMLParagraphElement>("dandisetEmbargoError"),
    viewDatasetLink: required<HTMLAnchorElement>("viewDatasetLink"),
    btnUpload: required<HTMLButtonElement>("btnUpload"),
    uploadStatus: required<HTMLSpanElement>("uploadStatus"),
    uploadProgress: required<HTMLDivElement>("uploadProgress"),
    uploadProgressFill: required<HTMLDivElement>("uploadProgressFill"),

    // Footer
    versionIndicator: required<HTMLAnchorElement>("version-indicator"),
  };
}

export type ClipExtractorElements = ReturnType<typeof getElements>;
