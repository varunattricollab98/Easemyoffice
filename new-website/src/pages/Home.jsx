import Hero from '../components/sections/Hero'
import TrustLogos from '../components/sections/TrustLogos'
import Stats from '../components/sections/Stats'
import Services from '../components/sections/Services'
import Pricing from '../components/sections/Pricing'
import ComparisonTable from '../components/sections/ComparisonTable'
import CityGrid from '../components/sections/CityGrid'
import HowItWorks from '../components/sections/HowItWorks'
import WhyChooseUs from '../components/sections/WhyChooseUs'
import Testimonials from '../components/sections/Testimonials'
import FAQ from '../components/sections/FAQ'
import FinalCTA from '../components/sections/FinalCTA'

export default function Home() {
  return (
    <>
      <Hero />
      <TrustLogos />
      <Stats />
      <Services />
      <Pricing />
      <ComparisonTable />
      <CityGrid />
      <HowItWorks />
      <WhyChooseUs />
      <Testimonials />
      <FAQ />
      <FinalCTA />
    </>
  )
}
