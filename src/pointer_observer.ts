import { SizedMap } from "@i-xi-dev/collection";
import { UiUtils } from "@i-xi-dev/ui-utils";

type _PointerId = number;

const PointerStatus = {
  ACTIVE: "-active",//TODO active pointerを意味しないので紛らわしい
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
};

type PointerData = {
  readonly pointerId: _PointerId,
  readonly pointerType: UiUtils.PointerType,
  readonly isPrimary: boolean,
  motion: Array<PointerEventRecord>,
  status: PointerStatus,

  //TODO  getCoalescedEvents(),

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
  getPredictedEvents(),
  height,
  pressure,
  tangentialPressure,
  tiltX,
  tiltY,
  twist,
  width,
  */
};

type PointerObserverEntry = {
  target: Element,
  pointerDataList: Array<PointerData>,
};

type PointerObserverCallback = (entries: Array<PointerObserverEntry>) => void;

type PointerObserverOptions = {
  pointermove?: boolean,//TODO booleanでなく、
  // 1:pointermoveが発火するたびにcallback実行
  // 2:まびく
  // 3:座標の記録だけして次にpointermove以外が起きた時にcallbackにわたす？とか historyの設定か？
  // 4:完全無視
  // にする

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

    if ((targetInfo.options.untrusted !== true) && (event.isTrusted !== true)) {
      return;
    }

    const { type, pointerId, pointerType } = event;
    const { dataSet } = targetInfo;
    let idUsed = dataSet.has(pointerId);

    let data: PointerData;
    if (idUsed === true) {
      data = dataSet.get(pointerId) as PointerData;
      data = PointerObserver.#updatePointerData(data, event);
      dataSet.delete(pointerId);
    }
    else {
      data = PointerObserver.#createPointerData(event);
    }
    dataSet.set(pointerId, data);




    // TODO pointermoveの場合にまびくか否か
    this.#callback([ this.#getEntry(target) ]);

    if (type === "pointerleave") {
      dataSet.delete(pointerId);
    }
  }

  static #createPointerData(event: PointerEvent): PointerData {
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

    const motion = [];
    //TODO getCoalescedEvents()がある場合追加

    motion.push({
      timeStamp: event.timeStamp,
      eventType: event.type,
      offsetX: event.offsetX,
      offsetY: event.offsetY,
      pageX: event.pageX,
      pageY: event.pageY,
    });

    return {
      pointerType: event.pointerType as UiUtils.PointerType,
      pointerId: event.pointerId,
      isPrimary: event.isPrimary,
      status,
      motion,
    };
  }

  static #updatePointerData(data: PointerData, event: PointerEvent): PointerData {
    console.assert(data.pointerType === event.pointerType, "pointerType");
    console.assert(data.pointerId === event.pointerId, "pointerId");
    console.assert(data.isPrimary === event.isPrimary, "isPrimary");// TODO 途中でかわる？

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

      //TODO getCoalescedEvents()がある場合追加
      data.motion.push({
        timeStamp: event.timeStamp,
        eventType: event.type,
        offsetX: event.offsetX,
        offsetY: event.offsetY,
        pageX: event.pageX,
        pageY: event.pageY,
      });
    }

    return data;
  }

  #getEntry(target: Element): PointerObserverEntry {
    const targetInfo = this.#targetInfoMap.get(target) as _TargetInfo;

    const pointerDataList: Array<PointerData> = [];
    Object.values(UiUtils.PointerType).forEach((pointerType) => {
      const dataMap = targetInfo.dataMap[pointerType];
      for (const pointerData of dataMap.values()) {
        pointerDataList.push(Object.assign({}, pointerData));
      }
    });
    pointerDataList.sort((a, b) => {
      return (a.history.at(-1) as [number, string])[0] - (b.history.at(-1) as [number, string])[0];
    });

    return {
      target,
      pointerDataList,
    };
  }
}
Object.freeze(PointerObserver);

export { PointerObserver };
