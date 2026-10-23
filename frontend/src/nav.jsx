import { createContext, useContext } from "react";

export const NavContext = createContext(() => {});
export const CONTACT = "anuragshukla8416@gmail.com";

export function Link({ to, children, ...rest }) {
  const go = useContext(NavContext);
  return (
    <a
      href={to}
      {...rest}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        go(to);
      }}
    >
      {children}
    </a>
  );
}
