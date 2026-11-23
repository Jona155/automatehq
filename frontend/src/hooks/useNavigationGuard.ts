import { useContext, useEffect, useRef } from 'react';
import { UNSAFE_NavigationContext } from 'react-router-dom';

/**
 * Intercepts in-app navigation (links, navigate()) while `when` is true and
 * hands the pending navigation to `onBlocked`, which decides whether to call
 * `proceed`. Also asks the browser to confirm closing/reloading the tab.
 *
 * The app uses <BrowserRouter>, which has no useBlocker; wrapping the router's
 * navigator is the supported-in-practice way to guard there. The browser's
 * Back button is covered by the tab-level confirmation only when it leaves the
 * app; an in-app Back is not intercepted.
 */
export function useNavigationGuard(when: boolean, onBlocked: (proceed: () => void) => void) {
  const { navigator } = useContext(UNSAFE_NavigationContext);
  const onBlockedRef = useRef(onBlocked);
  onBlockedRef.current = onBlocked;
  const bypassRef = useRef(false);

  useEffect(() => {
    if (!when) return undefined;

    const originalPush = navigator.push;
    const originalReplace = navigator.replace;
    const guard = <A extends unknown[]>(original: (...args: A) => void) => (...args: A) => {
      if (bypassRef.current) {
        original.apply(navigator, args);
        return;
      }
      onBlockedRef.current(() => {
        bypassRef.current = true;
        try {
          original.apply(navigator, args);
        } finally {
          bypassRef.current = false;
        }
      });
    };
    navigator.push = guard(originalPush);
    navigator.replace = guard(originalReplace);

    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);

    return () => {
      navigator.push = originalPush;
      navigator.replace = originalReplace;
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [when, navigator]);

  /** Run a navigation of our own without triggering the guard. */
  return (action: () => void) => {
    bypassRef.current = true;
    try {
      action();
    } finally {
      bypassRef.current = false;
    }
  };
}
