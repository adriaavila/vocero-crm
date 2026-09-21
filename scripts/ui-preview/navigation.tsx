import React, { createContext, useContext, useState, useEffect } from 'react';
const Navigation = createContext({ path: '/overview', navigate: (_path: string) => {} });
export function PreviewRouter({ children }: { children: React.ReactNode }) {
 const [path, setPath] = useState(location.hash.slice(1) || '/overview');
 useEffect(() => { const change = () => setPath(location.hash.slice(1) || '/overview'); addEventListener('hashchange',change); return () => removeEventListener('hashchange',change); },[]);
 return <Navigation.Provider value={{path,navigate:(p)=>{location.hash=p;setPath(p)}}}>{children}</Navigation.Provider>;
}
export function usePathname(){return useContext(Navigation).path.split('?')[0]!}
export function useRouter(){const {navigate}=useContext(Navigation);return {push:navigate,replace:navigate,refresh:()=>{}}}
export function useSearchParams(){return new URLSearchParams(useContext(Navigation).path.split('?')[1] || '')}
export default function Link({href,children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement> & {href:string}){const {navigate}=useContext(Navigation);return <a {...props} href={'#'+href} onClick={e=>{e.preventDefault();navigate(href)}}>{children}</a>}
