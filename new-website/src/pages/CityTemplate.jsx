import { useParams } from 'react-router-dom'
import { MapPin } from 'lucide-react'
import Button from '../components/ui/Button'
import { cities } from '../data/cities'

export default function CityTemplate() {
  const { citySlug } = useParams()
  const city = cities.find((c) => c.slug === citySlug)

  if (!city) {
    return (
      <div className="pt-24 pb-16">
        <div className="container-custom text-center">
          <h1 className="text-3xl font-bold text-text mb-4">City Not Found</h1>
          <Button to="/">Back to Home</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="pt-24 pb-16">
      <div className="container-custom text-center">
        <div className="max-w-2xl mx-auto">
          <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <MapPin className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-text mb-4">
            Virtual Office in {city.name}
          </h1>
          <p className="text-lg text-text-light mb-4">
            Get a premium business address in {city.name} starting at just &#8377;{city.price}/mo.
            Perfect for GST registration, company incorporation, and professional correspondence.
          </p>
          <p className="text-2xl font-bold text-primary mb-8">
            Starting &#8377;{city.price}/month
          </p>
          <Button to="/">Back to Home</Button>
        </div>
      </div>
    </div>
  )
}
