function required<T extends Element>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Expected #${id} to exist in the document`);
  return el as unknown as T;
}

export function getElements() {
  return {
    // Player
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

    // Source
    videoUrl: required<HTMLInputElement>("videoUrl"),
    loadVideoUrl: required<HTMLButtonElement>("loadVideoUrl"),
    pickVideo: required<HTMLButtonElement>("pickVideo"),
    sampleBtn: required<HTMLButtonElement>("sampleBtn"),
    sampleBtn2: required<HTMLButtonElement>("sampleBtn2"),
    drop: required<HTMLDivElement>("drop"),
    slpUrl: required<HTMLInputElement>("slpUrl"),
    loadSlpUrl: required<HTMLButtonElement>("loadSlpUrl"),
    pickSlp: required<HTMLButtonElement>("pickSlp"),
    showPose: required<HTMLInputElement>("showPose"),
    videoFile: required<HTMLInputElement>("videoFile"),
    slpFile: required<HTMLInputElement>("slpFile"),
    srcInfo: required<HTMLDivElement>("srcInfo"),
    log: required<HTMLDivElement>("log"),

    // Extract
    outSeg: required<HTMLDivElement>("outSeg"),
    clipOpts: required<HTMLDivElement>("clipOpts"),
    trimSeg: required<HTMLDivElement>("trimSeg"),
    ffCmd: required<HTMLPreElement>("ffCmd"),
    framesOpts: required<HTMLDivElement>("framesOpts"),
    fmtSeg: required<HTMLDivElement>("fmtSeg"),
    jpgQWrap: required<HTMLLabelElement>("jpgQWrap"),
    jpgQ: required<HTMLInputElement>("jpgQ"),
    burnPose: required<HTMLInputElement>("burnPose"),
    btnExtract: required<HTMLButtonElement>("btnExtract"),
    exProg: required<HTMLDivElement>("exProg"),
    exNote: required<HTMLDivElement>("exNote"),
    exResult: required<HTMLDivElement>("exResult"),

    // Annotations
    annBadge: required<HTMLSpanElement>("annBadge"),
    annSummary: required<HTMLDivElement>("annSummary"),
    annDetails: required<HTMLDetailsElement>("annDetails"),
    annPreview: required<HTMLPreElement>("annPreview"),
    dlAnn: required<HTMLButtonElement>("dlAnn"),

    // Transmit
    author: required<HTMLInputElement>("author"),
    origFilename: required<HTMLInputElement>("origFilename"),
    endpoint: required<HTMLInputElement>("endpoint"),
    useProxy: required<HTMLInputElement>("useProxy"),
    headers: required<HTMLTextAreaElement>("headers"),
    pkgSeg: required<HTMLDivElement>("pkgSeg"),
    pkgNote: required<HTMLDivElement>("pkgNote"),
    txBadge: required<HTMLSpanElement>("txBadge"),
    btnPreview: required<HTMLButtonElement>("btnPreview"),
    btnSend: required<HTMLButtonElement>("btnSend"),
    btnDownload: required<HTMLButtonElement>("btnDownload"),
    txNote: required<HTMLDivElement>("txNote"),
    txPreview: required<HTMLPreElement>("txPreview"),
  };
}

export type ClipExtractorElements = ReturnType<typeof getElements>;
