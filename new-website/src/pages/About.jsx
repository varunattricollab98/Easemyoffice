import { Building } from 'lucide-react'
import Button from '../components/ui/Button'

export default function About() {
  return (
    <div className="pt-24 pb-16">
      <div className="container-custom text-center">
        <div className="max-w-2xl mx-auto">
          <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Building className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-text mb-4">About EaseMyOffice</h1>
          <p className="text-lg text-text-light mb-8">
            India&apos;s leading virtual office provider with 200+ premium addresses across 28 states. We help businesses establish their presence professionally and affordably.
          </p>
          <Button to="/">Back to Home</Button>
        </div>
      </div>
    </div>
  )
}
