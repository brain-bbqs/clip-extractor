function required<T extends Element>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Expected #${id} to exist in the document`);
  return el as unknown as T;
}

export function getElements() {
  return {
    // Header
    themeToggle: required<HTMLButtonElement>("themeToggle"),

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
    srcInfo: required<HTMLDivElement>("srcInfo"),
    slpToggle: required<HTMLInputElement>("slpToggle"),

    // Player
    playerCard: required<HTMLElement>("playerCard"),
    modeSeg: required<HTMLDivElement>("modeSeg"),
    stage: required<HTMLDivElement>("stage"),
    emptyStage: required<HTMLDivElement>("emptyStage"),
    view: required<HTMLCanvasElement>("view"),
    overlayInfo: required<HTMLDivElement>("overlayInfo"),
    frameSlider: required<HTMLInputElement>("frameSlider"),
    selfill: required<HTMLDivElement>("selfill"),
    selplay: required<HTMLDivElement>("selplay"),
    btnFirst: required<HTMLButtonElement>("btnFirst"),
    btnPrev: required<HTMLButtonElement>("btnPrev"),
    btnPlay: required<HTMLButtonElement>("btnPlay"),
    btnNext: required<HTMLButtonElement>("btnNext"),
    btnLast: required<HTMLButtonElement>("btnLast"),
    speed: required<HTMLSelectElement>("speed"),
    btnSetIn: required<HTMLButtonElement>("btnSetIn"),
    btnSetOut: required<HTMLButtonElement>("btnSetOut"),
    inVal: required<HTMLDivElement>("inVal"),
    curVal: required<HTMLDivElement>("curVal"),
    outVal: required<HTMLDivElement>("outVal"),
    rangeSummary: required<HTMLSpanElement>("rangeSummary"),
    btnClearSel: required<HTMLButtonElement>("btnClearSel"),

    // SLEAP annotations card
    slpCard: required<HTMLElement>("slpCard"),
    slpDropzone: required<HTMLDivElement>("slpDropzone"),
    browseSlpBtn: required<HTMLButtonElement>("browseSlpBtn"),
    slpBadge: required<HTMLSpanElement>("slpBadge"),
    showPoseWrap: required<HTMLLabelElement>("showPoseWrap"),
    showPose: required<HTMLInputElement>("showPose"),

    // Upload (coming soon)
    btnUpload: required<HTMLButtonElement>("btnUpload"),
  };
}

export type ClipExtractorElements = ReturnType<typeof getElements>;
