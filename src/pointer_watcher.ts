// import { SizedMap } from "@i-xi-dev/collection";
import { UiUtils } from "@i-xi-dev/ui-utils";

type _PointerId = number;
type _PointerType = string;

const _PointerStatus = {
  IN_CONTACT: "in_contact",
  IN_PROXIMITY: "in_proximity",
  NONE: "none", // 交差していない or 交差しているが前面にヒット判定を持つ別の要素がある 
} as const;
type _PointerStatus = typeof _PointerStatus[keyof typeof _PointerStatus];

type PointerMovement = {
  readonly timeStamp: number,
  readonly eventType: string,
  readonly x: number,
  readonly y: number,
};

interface PointerData {
  id: _PointerId,
  type: _PointerType,
  isPrimary: boolean,
  isInProximity: boolean,
  isInContact: boolean,
  movements: Array<PointerMovement>,
}

class Pointer implements PointerData {
  readonly #id: _PointerId;
  readonly #type: _PointerType;
  readonly #primary: boolean;
  readonly #movements: Array<PointerMovement>;
  #status: _PointerStatus;
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
  constructor(event: PointerEvent) {
    if (typeof event.pointerId !== "number") {
      throw new TypeError("event.pointerId");
    }
    if (typeof event.pointerType !== "string") {
      throw new TypeError("event.pointerType");
    }
    this.#id = event.pointerId;
    this.#type = event.pointerType;
    this.#primary = (event.isPrimary === true);

    this.#movements = [];
    this.#status = _PointerStatus.IN_PROXIMITY;
  }
  get id(): number {
    return this.#id;
  }
  get type(): string {
    return this.#type;
  }
  get isPrimary(): boolean {
    return this.#primary;
  }
  get isInProximity(): boolean {
    return (this.#status === _PointerStatus.IN_CONTACT) || (this.#status === _PointerStatus.IN_PROXIMITY);
  }
  get isInContact(): boolean {
    return (this.#status === _PointerStatus.IN_CONTACT);
  }
  get movements(): Array<PointerMovement> {
    return this.#movements;
  }
  toJSON(): PointerData {
    return {
      id: this.#id,
      type: this.#type,
      isPrimary: this.#primary,
      isInProximity: this.isInProximity,
      isInContact: this.isInContact,
      movements: [ ...this.#movements ],
    };
  }
  update(event: PointerEvent, precision?: boolean): void {
    console.assert(this.#id === event.pointerId, "pointerId");
    console.assert(this.#type === event.pointerType, "pointerType");
    console.assert(this.#primary === event.isPrimary, "isPrimary");

    this.#addMovements(event, precision);
    this.#updateStatus(event);

    // TODO dispatchEvent
    console.log(JSON.stringify(this.toJSON()));
  }

  #addMovements(event: PointerEvent, precision?: boolean): void {
    if ((precision === true) && (event.type === "pointermove")) {
      for (const coalesced of event.getCoalescedEvents()) {
        this.#movements.push(Object.freeze({
          timeStamp: coalesced.timeStamp,
          eventType: coalesced.type,
          x: coalesced.offsetX,
          y: coalesced.offsetY,
        }));    
      }
    }
    else {
      this.#movements.push(Object.freeze({
        timeStamp: event.timeStamp,
        eventType: event.type,
        x: event.offsetX,
        y: event.offsetY,
      }));
    }
  }
  #updateStatus(event: PointerEvent): void {
    if (event.type === "pointerdown") {
      if (this.#type === UiUtils.PointerType.MOUSE) {
        if (event.button === 0) {
          this.#status = _PointerStatus.IN_CONTACT;
        }
      }
      else {
        this.#status = _PointerStatus.IN_CONTACT;
      }
    }
    else if (event.type === "pointerup") {
      if (this.#type === UiUtils.PointerType.MOUSE) {
        if (event.button === 0) {
          this.#status = _PointerStatus.IN_PROXIMITY;
        }
      }
      else {
        this.#status = _PointerStatus.IN_PROXIMITY;
      }
    }
    else if (event.type === "pointercancel") {
      this.#status = _PointerStatus.IN_PROXIMITY;
    }
    else if (event.type === "pointerleave") {
      this.#status = _PointerStatus.NONE;
    }
  }
}

const _targetEventTypes = [
  "gotpointercapture",
  "lostpointercapture",
  "pointercancel",
  "pointerdown",
  "pointerenter", // XXX windowかつmouseの場合などで発火しないので注意
  "pointerleave", // XXX windowかつmouseの場合などで発火しないので注意
  "pointermove",
  // "pointerout", // 子孫要素に乗るたびに発火するのでwindowでlistenしても意味ない
  // "pointerover",  // 子孫要素に乗るたびに発火するのでwindowでlistenしても意味ない
  // "pointerrawupdate", //TODO オプションとする
  "pointerup",
];

type PointerWatcherOptions = {
  precision?: boolean,  // getCoalescedEvents()の結果も記録するか否か

  // TODO pointerrawupdate

  // nonPrimary?: boolean, //XXX 途中で変わるならあまり意味ない
  untrusted?: boolean,
};

// ElementでもWindowでも使えるようにしようと思ったが、
// - FirefoxはwindowにaddEventListenerで"pointer*"のリスナを登録できない（onpointer*で総入替ならできるが…）
// - Chromeはwindowではマウスの場合にpointereneter,pointerleaveが発火しない
// 等々で互換性がないのでやめた
class PointerWatcher {
  #target: Element;
  #options: PointerWatcherOptions;
  #abortController: AbortController;
  #pointers: Map<_PointerId, Pointer>;
  #stream: ReadableStream<Pointer>;
  // TODO state

  constructor(target: Element, options: PointerWatcherOptions = {}) {
    this.#target = target;
    this.#options = options;
    this.#abortController = new AbortController();
    this.#pointers = new Map();

    const listenerOptions = {
      passive: true,
      signal: this.#abortController.signal,
    };

    const start = (controller: ReadableStreamController<Pointer>): void => {
      _targetEventTypes.forEach((eventType: string) => {
        target.addEventListener(eventType, ((event: PointerEvent) => {
          if ((this.#options.untrusted !== true) && (event.isTrusted !== true)) {
            return;
          }

          let pointer: Pointer;
          if (this.#pointers.has(event.pointerId) === true) {
            pointer = this.#pointers.get(event.pointerId) as Pointer;
          }
          else {
            pointer = new Pointer(event);
            this.#pointers.set(event.pointerId, pointer);
            try {
              controller.enqueue(pointer);
            }
            catch(exception) {
              // TODO
              console.log(exception);
            }
          }
          pointer.update(event, this.#options.precision);
        }) as EventListener, listenerOptions);
      });
    };
    const cancel = (): void => {
      this.#abortController.abort();
    };

    this.#stream = new ReadableStream({
      start,
      // pull
      cancel,
    });

    Object.freeze(this);
  }
  get stream(): ReadableStream<Pointer> {
    return this.#stream;
  }
  dispose(): void {
    this.#stream.cancel().catch((r) => console.log(r)/* TODO */);
    this.#pointers.clear();
  }


}

Object.freeze(PointerWatcher);

export { PointerWatcher };
