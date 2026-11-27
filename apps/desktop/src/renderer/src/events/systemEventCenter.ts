import type { SystemEventEnvelope } from "@deepwrite/contracts";

export type SystemEventType = SystemEventEnvelope["type"];

export type SystemEventOf<TType extends SystemEventType> = Extract<
  SystemEventEnvelope,
  { type: TType }
>;

export type SystemEventListener<TType extends SystemEventType> = (
  event: SystemEventOf<TType>
) => void;

export type AllSystemEventListener = (event: SystemEventEnvelope) => void;
export type UnsubscribeSystemEvent = () => void;

export interface SystemEventListenerErrorContext {
  event: SystemEventEnvelope;
  /** `null` identifies a listener registered through `subscribeAll`. */
  subscribedType: SystemEventType | null;
}

export interface SystemEventCenterOptions {
  onListenerError?: (
    error: unknown,
    context: SystemEventListenerErrorContext
  ) => void;
}

export interface SystemEventCenter {
  subscribeAll(listener: AllSystemEventListener): UnsubscribeSystemEvent;
  subscribe<TType extends SystemEventType>(
    type: TType,
    listener: SystemEventListener<TType>
  ): UnsubscribeSystemEvent;
  publish(event: SystemEventEnvelope): void;
  clear(): void;
}

interface Subscription {
  subscribedType: SystemEventType | null;
  listener: AllSystemEventListener;
}

function createUnsubscribe(
  subscriptions: Map<symbol, Subscription>,
  subscriptionId: symbol
): UnsubscribeSystemEvent {
  // This closure is created in a scope that has never received the listener,
  // so retaining an unsubscribe callback cannot retain an unloaded module.
  return () => {
    subscriptions.delete(subscriptionId);
  };
}

/**
 * Synchronous renderer event fan-out for the single preload event stream.
 *
 * Dispatch snapshots only subscription ids, not listener functions. A listener
 * removed before its turn is skipped immediately, a listener added during a
 * dispatch starts with the next event, and `clear()` can release all module
 * callbacks even while another listener is running.
 */
export function createSystemEventCenter(
  options: SystemEventCenterOptions = {}
): SystemEventCenter {
  const subscriptions = new Map<symbol, Subscription>();

  function addSubscription(subscription: Subscription): UnsubscribeSystemEvent {
    const subscriptionId = Symbol("system-event-subscription");
    subscriptions.set(subscriptionId, subscription);
    return createUnsubscribe(subscriptions, subscriptionId);
  }

  function reportListenerError(
    error: unknown,
    context: SystemEventListenerErrorContext
  ): void {
    try {
      options.onListenerError?.(error, context);
    } catch {
      // Diagnostics must never interrupt delivery to remaining listeners.
    }
  }

  return {
    subscribeAll(listener) {
      return addSubscription({ subscribedType: null, listener });
    },

    subscribe(type, listener) {
      const narrowedListener: AllSystemEventListener = (event) => {
        listener(event as SystemEventOf<typeof type>);
      };
      return addSubscription({
        subscribedType: type,
        listener: narrowedListener
      });
    },

    publish(event) {
      // IDs preserve global registration order across typed and all-event
      // subscriptions without retaining callbacks removed during dispatch.
      const dispatchOrder = [...subscriptions.keys()];
      for (const subscriptionId of dispatchOrder) {
        const subscription = subscriptions.get(subscriptionId);
        if (
          !subscription ||
          (subscription.subscribedType !== null &&
            subscription.subscribedType !== event.type)
        ) {
          continue;
        }
        try {
          subscription.listener(event);
        } catch (error: unknown) {
          reportListenerError(error, {
            event,
            subscribedType: subscription.subscribedType
          });
        }
      }
    },

    clear() {
      subscriptions.clear();
    }
  };
}

/** Shared target for the renderer's one future `deepwriteApi().events` tap. */
export const systemEventCenter = createSystemEventCenter();
