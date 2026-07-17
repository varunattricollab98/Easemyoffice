import PricingSection from '../components/sections/Pricing'
import Button from '../components/ui/Button'

export default function PricingPage() {
  return (
    <div className="pt-20">
      <PricingSection />
      <div className="text-center pb-16">
        <Button to="/">Back to Home</Button>
      </div>
    </div>
  )
}
