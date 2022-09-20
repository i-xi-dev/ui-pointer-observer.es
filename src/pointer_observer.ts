import { SizedMap } from "@i-xi-dev/collection";
import { UiUtils } from "@i-xi-dev/ui-utils";

type _PointerId = number;

const PointerStatus = {
  ACTIVE: "active",
  INACTIVE: "inactive",
  DISABLED: "disabled",
} as const;
type PointerStatus = typeof PointerStatus[keyof typeof PointerStatus];

type _PointerData = {
  pointerType: UiUtils.PointerType,
  pointerId: _PointerId,
  primary: boolean,
  status: PointerStatus,
  offsetX: number,
  offsetY: number,
  pageX: number,
  pageY: number,

  history: Array<[number, string]>;

  /* TODO
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
  getCoalescedEvents(),
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

type _PointerDataMap = SizedMap<_PointerId, _PointerData>;

type PointerObserverEntry = {
  target: Element,
  pointerDataList: Array<_PointerData>,
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
  dataMap: Record<UiUtils.PointerType, _PointerDataMap>,
};

const _MAX_HISTORY = 6;

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
    // "pointermove", optionsによる
    // "pointerout", // 要素に乗るたびに発火するのでwindowでlistenしても意味ない
    // "pointerover",  // 要素に乗るたびに発火するのでwindowでlistenしても意味ない
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
      dataMap: {
        [UiUtils.PointerType.MOUSE]: new SizedMap(1),
        [UiUtils.PointerType.PEN]: new SizedMap(1), // XXX 複数はありえないのか？
        [UiUtils.PointerType.TOUCH]: new SizedMap(window.navigator.maxTouchPoints), // TODO primaryのointerIdが途中で変わらないならprimaryのみの場合1
      },
    });
    const listenerOptions = {
      passive: true,
      signal: controller.signal,
    };

    const eventTypes = [ ...PointerObserver.#eventTypes ];
    if (options.pointermove === true) {
      eventTypes.push("pointermove");
    }
    eventTypes.forEach((eventType: string) => {
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
    const dataMap = targetInfo.dataMap[pointerType as UiUtils.PointerType];
    let data: _PointerData;
    if (dataMap.has(pointerId) === true) {
      data = dataMap.get(pointerId) as _PointerData;
      data = PointerObserver.#updateEntry(data, event);
    }
    else {
      data = PointerObserver.#createEntry(event);
    }

    if (dataMap.has(pointerId) === true) {
      dataMap.delete(pointerId);
    }
    dataMap.set(pointerId, data);

    // TODO ためる
    this.#callback([ this.#getEntry(target) ]);

    if (type === "pointerleave") {
      dataMap.delete(pointerId);
    }
  }

  static #createEntry(event: PointerEvent): _PointerData {
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

    return {
      pointerType: event.pointerType as UiUtils.PointerType,
      pointerId: event.pointerId,
      primary: (event.isPrimary === true),
      status,
      offsetX: event.offsetX,
      offsetY: event.offsetY,
      pageX: event.pageX,
      pageY: event.pageY,
      history: [ [ event.timeStamp, event.type ] ],
    };
  }

  static #updateEntry(data: _PointerData, event: PointerEvent): _PointerData {
    console.assert(data.pointerType === event.pointerType, "pointerType");
    console.assert(data.pointerId === event.pointerId, "pointerId");
    console.assert(data.primary === event.isPrimary, "isPrimary");// TODO 途中でかわる？

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
    data.offsetX = event.offsetX;
    data.offsetY = event.offsetY;
    data.pageX = event.pageX;
    data.pageY = event.pageY;
    data.history.push([ event.timeStamp, event.type ]);
    if (data.history.length > _MAX_HISTORY) {
      data.history.shift();
    }
    return data;
  }

  #getEntry(target: Element): PointerObserverEntry {
    const targetInfo = this.#targetInfoMap.get(target) as _TargetInfo;

    const pointerDataList: Array<_PointerData> = [];
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
