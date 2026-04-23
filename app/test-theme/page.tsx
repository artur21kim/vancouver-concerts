import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

export default function TestTheme() {
return (
<div className="min-h-screen bg-background p-8">
  <div className="max-w-4xl mx-auto space-y-8">
    <h1 className="text-4xl font-bold text-foreground">Theme Test</h1>

    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Shows</CardTitle>
          <CardDescription>Total concerts</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold">35,136</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Artists</CardTitle>
          <CardDescription>Unique performers</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold">11,656</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Venues</CardTitle>
          <CardDescription>Concert locations</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold">1,112</p>
        </CardContent>
      </Card>
    </div>

    <div className="space-x-2">
      <Button>Primary Button</Button>
      <Button variant="secondary">Secondary Button</Button>
      <Button variant="outline">Outline Button</Button>
      <Button variant="ghost">Ghost Button</Button>
    </div>

    <div className="space-x-2">
      <Badge>Default Badge</Badge>
      <Badge variant="secondary">Secondary Badge</Badge>
      <Badge variant="outline">Outline Badge</Badge>
    </div>
  </div>
</div>
)
}