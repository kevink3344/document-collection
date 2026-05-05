import { Outlet } from 'react-router-dom'
import TopNavBar from '../components/layout/TopNavBar'
import SideNav from '../components/layout/SideNav'

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col bg-[#FAFAFA] dark:bg-[#0F172A]">
      <TopNavBar />
      <div className="flex flex-1 overflow-hidden">
        <SideNav />
        <main className="flex-1 overflow-auto p-6 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
