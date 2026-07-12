import { HashRouter, Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import ProfilEdit from './pages/ProfilEdit'
import FilialeList from './pages/FilialeList'
import FilialeEdit from './pages/FilialeEdit'
import MitarbeiterEdit from './pages/MitarbeiterEdit'
import OcrScan from './pages/OcrScan'
import KatalogEdit from './pages/KatalogEdit'
import WocheStart from './pages/WocheStart'
import PlanEditor from './pages/PlanEditor'

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/profil" element={<ProfilEdit />} />
        <Route path="/filialen" element={<FilialeList />} />
        <Route path="/filiale/:id" element={<FilialeEdit />} />
        <Route path="/filiale/:filialeId/ma/:maId" element={<MitarbeiterEdit />} />
        <Route path="/filiale/:id/scan" element={<OcrScan />} />
        <Route path="/filiale/:id/katalog" element={<KatalogEdit />} />
        <Route path="/woche" element={<WocheStart />} />
        <Route path="/plan/:filialeId/:jahr/:kw" element={<PlanEditor />} />
      </Routes>
    </HashRouter>
  )
}
