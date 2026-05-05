import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import TopNavBar from '../components/layout/TopNavBar'
import SideNav from '../components/layout/SideNav'

export default function HomePage() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  return (
    <div className="min-h-screen flex flex-col bg-[#FAFAFA] dark:bg-[#0F172A]">
      <TopNavBar onAppIconClick={() => setMobileNavOpen(open => !open)} />
      <div className="flex flex-1 overflow-hidden">
        <SideNav
          mobileDrawerOpen={mobileNavOpen}
          onCloseMobileDrawer={() => setMobileNavOpen(false)}
        />
        <main className="flex-1 overflow-auto p-6 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
