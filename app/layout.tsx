import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'The Adventurer’s Codex',description:'Prepare less. Remember more. Tell better stories.',manifest:'/manifest.json',icons:{icon:'/favicon.svg',apple:'/icon-192.png'}};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
