'use client'

import { IconTrendingDown, IconTrendingUp } from "@tabler/icons-react"
import { useEmailStats, useMessages } from "@/hooks/use-api"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export function SectionCards() {
  // Get local email statistics from D1 database
  const { data: emailStats, isLoading: statsLoading } = useEmailStats()
  
  // Get sent messages from Mailjet for accurate sent count
  const { data: sentMessages, isLoading: sentLoading } = useMessages({ 
    messageStatus: 'sent',
    limit: 1000 
  })
  
  // Use D1 stats for most counts, Mailjet for sent count
  const totalEmails = emailStats?.total || 0
  const sentCount = sentMessages?.Count || emailStats?.sent || 0
  const queuedEmails = (emailStats?.queued || 0) + (emailStats?.processing || 0)
  const failedEmails = (emailStats?.failed || 0) + (emailStats?.dead || 0)
  
  const successRate = totalEmails > 0 ? ((sentCount / totalEmails) * 100).toFixed(1) : 0
  const failureRate = totalEmails > 0 ? ((failedEmails / totalEmails) * 100).toFixed(1) : 0
  
  const isLoading = statsLoading || sentLoading
  
  return (
    <div className="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>Total Emails</CardDescription>
          {isLoading ? (
            <Skeleton className="h-9 w-32" />
          ) : (
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {totalEmails.toLocaleString()}
            </CardTitle>
          )}
          <CardAction>
            <Badge variant="outline">
              <IconTrendingUp />
              All time
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            Email jobs processed
          </div>
          <div className="text-muted-foreground">
            Total emails in the queue
          </div>
        </CardFooter>
      </Card>
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>Successfully Sent</CardDescription>
          {isLoading ? (
            <Skeleton className="h-9 w-32" />
          ) : (
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {sentCount.toLocaleString()}
            </CardTitle>
          )}
          <CardAction>
            <Badge variant="outline">
              <IconTrendingUp />
              {successRate}%
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            Successfully delivered <IconTrendingUp className="size-4" />
          </div>
          <div className="text-muted-foreground">
            {successRate}% delivery success rate
          </div>
        </CardFooter>
      </Card>
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>In Queue</CardDescription>
          {isLoading ? (
            <Skeleton className="h-9 w-32" />
          ) : (
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {queuedEmails.toLocaleString()}
            </CardTitle>
          )}
          <CardAction>
            <Badge variant="outline">
              Pending
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            Awaiting processing
          </div>
          <div className="text-muted-foreground">Queued & processing emails</div>
        </CardFooter>
      </Card>
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>Failed Deliveries</CardDescription>
          {isLoading ? (
            <Skeleton className="h-9 w-32" />
          ) : (
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {failedEmails.toLocaleString()}
            </CardTitle>
          )}
          <CardAction>
            <Badge variant={failedEmails > 0 ? "destructive" : "outline"}>
              {failedEmails > 0 ? <IconTrendingDown /> : <IconTrendingUp />}
              {failureRate}%
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            {failedEmails > 0 ? 'Needs attention' : 'No failures'} {failedEmails > 0 ? <IconTrendingDown className="size-4" /> : <IconTrendingUp className="size-4" />}
          </div>
          <div className="text-muted-foreground">{failureRate}% failure rate</div>
        </CardFooter>
      </Card>
    </div>
  )
}
