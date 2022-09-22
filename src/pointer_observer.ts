// import { SizedMap } from "@i-xi-dev/collection";
import { UiUtils } from "@i-xi-dev/ui-utils";

type _PointerId = number;

const PointerStatus = {
  ACTIVE: "-active", // TODO active pointerを意味しないので紛らわしい
  INACTIVE: "-inactive",
  DISABLED: "-disabled",
} as const;
type PointerStatus = typeof PointerStatus[keyof typeof PointerStatus];

type PointerEventRecord = {
  readonly timeStamp: number,
  readonly eventType: string,
  readonly offsetX: number,
  readonly offsetY: number,
  readonly pageX: number,
  readonly pageY: number,
  readonly coalesced?: boolean, //TODO いるか？
};

type PointerData = {
  readonly pointerId: _PointerId,
  readonly pointerType: UiUtils.PointerType,
  readonly isPrimary: boolean,
  motion: Array<PointerEventRecord>,  // TODO 前回との差分のみ持って、全レコードは別で持つ
  status: PointerStatus,

  /* TODO
  buttons,
  altKey,
  ctrlKey,
  currentTarget,
  getModifierState(),
  metaKey,
  relatedTarget,
  shiftKey,
  target,
  */

  /* XXX
  composed,
  composedPath(),
  getPredictedEvents(), いらない
  height,
  pressure,
  tangentialPressure,
  tiltX,
  tiltY,
  twist,
  width,
  */
};

function _addMotionRecords(precision: boolean, motion: Array<PointerEventRecord>, event: PointerEvent): void {
  if ((precision === true) && (event.type === "pointermove")) {
    for (const coalesced of event.getCoalescedEvents()) {
      motion.push({
        timeStamp: coalesced.timeStamp,
        eventType: coalesced.type,
        offsetX: coalesced.offsetX,
        offsetY: coalesced.offsetY,
        pageX: coalesced.pageX,
        pageY: coalesced.pageY,
        coalesced: true,
      });    
    }
  }
  else {
    motion.push({
      timeStamp: event.timeStamp,
      eventType: event.type,
      offsetX: event.offsetX,
      offsetY: event.offsetY,
      pageX: event.pageX,
      pageY: event.pageY,
    });
  }
}

function _createPointerData(event: PointerEvent, precision: boolean): PointerData {
  let status: PointerStatus = PointerStatus.INACTIVE;
  if (event.type === "pointerdown") {
    if (event.pointerType === UiUtils.PointerType.MOUSE) {
      if (event.button === 0) {
        status = PointerStatus.ACTIVE;
      }
    }
    else {
      status = PointerStatus.ACTIVE;
    }
  }

  const motion: Array<PointerEventRecord> = [];
  _addMotionRecords(precision, motion, event);

  return {
    pointerType: event.pointerType as UiUtils.PointerType,
    pointerId: event.pointerId,
    isPrimary: event.isPrimary,
    status,
    motion,
  };
}

function _updatePointerData(data: PointerData, event: PointerEvent, precision: boolean): PointerData {
  console.assert(data.pointerType === event.pointerType, "pointerType");
  console.assert(data.pointerId === event.pointerId, "pointerId");
  console.assert(data.isPrimary === event.isPrimary, "isPrimary");

  let newStatus: PointerStatus | undefined = undefined;
  if (event.type === "pointerdown") {
    if (event.pointerType === UiUtils.PointerType.MOUSE) {
      if (event.button === 0) {
        newStatus = PointerStatus.ACTIVE;
      }
    }
    else {
      newStatus = PointerStatus.ACTIVE;
    }
  }
  else if (event.type === "pointerup") {
    if (event.pointerType === UiUtils.PointerType.MOUSE) {
      if (event.button === 0) {
        newStatus = PointerStatus.INACTIVE;
      }
    }
    else {
      newStatus = PointerStatus.INACTIVE;
    }
  }
  else if (event.type === "pointercancel") {
    newStatus = PointerStatus.INACTIVE;
  }
  else if (event.type === "pointerleave") {
    newStatus = PointerStatus.DISABLED;
  }

  if (newStatus) {
    data.status = newStatus;
  }

  _addMotionRecords(precision, data.motion, event);

  return data;
}

type PointerObserverEntry = {
  target: Element,
  pointerDataList: Array<PointerData>,
};

type PointerObserverCallback = (entries: Array<PointerObserverEntry>) => void;

type PointerObserverOptions = {
  precision?: boolean,  // getCoalescedEvents()の結果も記録するか否か

  // TODO pointerrawupdate

  // nonPrimary?: boolean, //XXX 途中で変わるならあまり意味ない
  untrusted?: boolean,
};

type _TargetInfo = {
  controller: AbortController,
  options: PointerObserverOptions,
  dataSet: Map<number, PointerData>,
};

// ElementでもWindowでも使えるようにしようと思ったが、
// - FirefoxはwindowにaddEventListenerで"pointer*"のリスナを登録できない（onpointer*で総入替ならできるが…）
// - Chromeはwindowではマウスの場合にpointereneter,pointerleaveが発火しない
// 等々で互換性がないのでやめた
class PointerObserver {
  static #eventTypes = [
    "gotpointercapture",
    "lostpointercapture",
    "pointercancel",
    "pointerdown",
    "pointerenter", // XXX windowかつmouseの場合などで発火しないので注意
    "pointerleave", // XXX windowかつmouseの場合などで発火しないので注意
    "pointermove",
    // "pointerout", // 子孫要素に乗るたびに発火するのでwindowでlistenしても意味ない
    // "pointerover",  // 子孫要素に乗るたびに発火するのでwindowでlistenしても意味ない
    // "pointerrawupdate", // オプションとする
    "pointerup",
  ];

  #targetInfoMap: Map<Element, _TargetInfo>;

  #callback: PointerObserverCallback;

  constructor(callback: PointerObserverCallback) {
    if (typeof callback !== "function") {
      throw new TypeError("callback");
    }

    this.#targetInfoMap = new Map();
    this.#callback = callback;
  }

  observe(target: Element, options: PointerObserverOptions = {}): void {
    const controller = new AbortController();
    this.#targetInfoMap.set(target, {
      controller,
      options,
      dataSet: new Map(),
    });
    const listenerOptions = {
      passive: true,
      signal: controller.signal,
    };

    PointerObserver.#eventTypes.forEach((eventType: string) => {
      target.addEventListener(eventType, ((event: PointerEvent) => {
        this.#on(event);
      }) as EventListener, listenerOptions);
    });
  }

  unobserve(target: Element): void {
    const { controller } = this.#targetInfoMap.get(target) as _TargetInfo;
    controller.abort();
  }

  #on(event: PointerEvent): void {
    const target = event.target as Element;
    const targetInfo = this.#targetInfoMap.get(target) as _TargetInfo;
    const { options } = targetInfo;

    if ((options.untrusted !== true) && (event.isTrusted !== true)) {
      return;
    }

    const { type, pointerId } = event;
    const { dataSet } = targetInfo;
    const idUsed = dataSet.has(pointerId);

    let data: PointerData;
    if (idUsed === true) {
      data = dataSet.get(pointerId) as PointerData;
      data = _updatePointerData(data, event, options.precision === true);
      dataSet.delete(pointerId);
    }
    else {
      data = _createPointerData(event, options.precision === true);
    }
    dataSet.set(pointerId, data);




    // TODO callbackのよびかた
    this.#callback([ this.#getEntry(target) ]);

    if (type === "pointerleave") {
      dataSet.delete(pointerId);
    }
  }

  // TODO
  #getEntry(target: Element): PointerObserverEntry {
    const targetInfo = this.#targetInfoMap.get(target) as _TargetInfo;

    return {
      target,
      pointerDataList: [ ...targetInfo.dataSet.values() ],
    };
  }
}
Object.freeze(PointerObserver);

export { PointerObserver };
