'use client'

import * as React from "react"
import { useEmailsPaginated } from "@/hooks/use-api"
import { formatDistanceToNow } from 'date-fns'
import {
  IconCircleCheckFilled,
  IconLoader,
  IconAlertTriangle,
  IconClock,
  IconX,
  IconRefresh,
} from "@tabler/icons-react"
import {
  type ColumnDef,
  type ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  IconChevronLeft,
  IconChevronRight,
  IconChevronsLeft,
  IconChevronsRight,
} from "@tabler/icons-react"

interface Email {
  id: string
  recipient: string
  subject: string
  body: string
  status: string
  retry_count: number
  created_at: string
  updated_at: string
}

function StatusBadge({ status }: { status: string }) {
  const statusConfig: Record<string, { icon: React.ReactNode; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    queued: { icon: <IconClock className="size-3" />, variant: "outline" },
    processing: { icon: <IconLoader className="size-3 animate-spin" />, variant: "secondary" },
    sent: { icon: <IconCircleCheckFilled className="size-3 fill-green-500" />, variant: "default" },
    failed: { icon: <IconAlertTriangle className="size-3" />, variant: "destructive" },
    dead: { icon: <IconX className="size-3" />, variant: "destructive" },
  }
  
  const config = statusConfig[status] || statusConfig.queued
  
  return (
    <Badge variant={config.variant} className="gap-1">
      {config.icon}
      {status}
    </Badge>
  )
}

const columns: ColumnDef<Email>[] = [
  {
    id: "select",
    header: ({ table }) => (
      <div className="flex items-center justify-center">
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
        />
      </div>
    ),
    cell: ({ row }) => (
      <div className="flex items-center justify-center">
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
        />
      </div>
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "recipient",
    header: "Recipient",
    cell: ({ row }) => (
      <div className="font-medium">{row.original.recipient}</div>
    ),
  },
  {
    accessorKey: "subject",
    header: "Subject",
    cell: ({ row }) => (
      <div className="max-w-md truncate">{row.original.subject}</div>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "retry_count",
    header: "Retries",
    cell: ({ row }) => (
      <div className="text-center">{row.original.retry_count}</div>
    ),
  },
  {
    accessorKey: "created_at",
    header: "Created",
    cell: ({ row }) => (
      <div className="text-muted-foreground text-sm">
        {formatDistanceToNow(new Date(row.original.created_at), { addSuffix: true })}
      </div>
    ),
  },
]

export function EmailDataTable() {
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const [rowSelection, setRowSelection] = React.useState({})
  const [statusFilter, setStatusFilter] = React.useState<string>("all")
  const [pageIndex, setPageIndex] = React.useState(0)
  const [pageSize, setPageSize] = React.useState(20)
  
  const { data: paginatedData, error, isLoading, mutate } = useEmailsPaginated({ 
    limit: pageSize,
    offset: pageIndex * pageSize,
    status: statusFilter === "all" ? undefined : statusFilter,
    orderBy: 'created_at',
    order: 'DESC'
  })
  
  const emails = paginatedData?.emails || []
  const totalRows = paginatedData?.total || 0
  const pageCount = Math.ceil(totalRows / pageSize)
  
  const table = useReactTable({
    data: emails,
    columns,
    pageCount,
    state: {
      sorting,
      columnFilters,
      rowSelection,
      pagination: {
        pageIndex,
        pageSize,
      },
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onRowSelectionChange: setRowSelection,
    onPaginationChange: (updater) => {
      if (typeof updater === 'function') {
        const newState = updater({ pageIndex, pageSize })
        setPageIndex(newState.pageIndex)
        setPageSize(newState.pageSize)
      }
    },
    manualPagination: true,
  })
  
  // Reset to first page when status filter changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: need to reset page on filter change
  React.useEffect(() => {
    setPageIndex(0)
  }, [statusFilter])
  
  if (error) {
    return (
      <div className="px-4 lg:px-6">
        <Alert variant="destructive">
          <IconAlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Failed to load emails: {error.message}
          </AlertDescription>
        </Alert>
      </div>
    )
  }
  
  return (
    <div className="px-4 lg:px-6">
      <div className="border rounded-lg bg-card">
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">Email Queue</h3>
              <p className="text-sm text-muted-foreground">
                Manage and monitor your email jobs
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => mutate()}>
              <IconRefresh className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
          
          <div className="flex items-center gap-4">
            <Input
              placeholder="Filter by recipient..."
              value={(table.getColumn("recipient")?.getFilterValue() as string) ?? ""}
              onChange={(event) =>
                table.getColumn("recipient")?.setFilterValue(event.target.value)
              }
              className="max-w-sm"
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="queued">Queued</SelectItem>
                <SelectItem value="processing">Processing</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="dead">Dead</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        
        <div className="border-t">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {[...Array(5)].map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: simpler implementation
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id}>
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows?.length ? (
                  table.getRowModel().rows.map((row) => (
                    <TableRow
                      key={row.id}
                      data-state={row.getIsSelected() && "selected"}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="h-24 text-center"
                    >
                      No emails found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </div>
        
        <div className="flex items-center justify-between px-4 py-4 border-t">
          <div className="flex-1 text-sm text-muted-foreground">
            {table.getFilteredSelectedRowModel().rows.length} of{" "}
            {totalRows} total row(s) selected.
          </div>
          <div className="flex items-center space-x-6 lg:space-x-8">
            <div className="flex items-center space-x-2">
              <p className="text-sm font-medium">Rows per page</p>
              <Select
                value={`${pageSize}`}
                onValueChange={(value) => {
                  setPageSize(Number(value))
                  setPageIndex(0)
                }}
              >
                <SelectTrigger className="h-8 w-[70px]">
                  <SelectValue placeholder={pageSize} />
                </SelectTrigger>
                <SelectContent side="top">
                  {[10, 20, 30, 40, 50].map((size) => (
                    <SelectItem key={size} value={`${size}`}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex w-[100px] items-center justify-center text-sm font-medium">
              Page {pageIndex + 1} of {pageCount || 1}
            </div>
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                className="hidden h-8 w-8 p-0 lg:flex"
                onClick={() => setPageIndex(0)}
                disabled={pageIndex === 0}
              >
                <span className="sr-only">Go to first page</span>
                <IconChevronsLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                className="h-8 w-8 p-0"
                onClick={() => setPageIndex(prev => Math.max(0, prev - 1))}
                disabled={pageIndex === 0}
              >
                <span className="sr-only">Go to previous page</span>
                <IconChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                className="h-8 w-8 p-0"
                onClick={() => setPageIndex(prev => Math.min(pageCount - 1, prev + 1))}
                disabled={pageIndex >= pageCount - 1}
              >
                <span className="sr-only">Go to next page</span>
                <IconChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                className="hidden h-8 w-8 p-0 lg:flex"
                onClick={() => setPageIndex(pageCount - 1)}
                disabled={pageIndex >= pageCount - 1}
              >
                <span className="sr-only">Go to last page</span>
                <IconChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
