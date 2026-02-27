/**
 * Job Queue — Workflow Step Definitions
 *
 * Defines workflow steps for sequential and parallel orchestration.
 */
import type { WorkflowStep } from "../../../src/queue/types.js"

/** Sequential order processing — each step receives the previous result */
export const orderProcessingSteps: WorkflowStep[] = [
  {
    name: "validate-payment",
    queue: "orders",
    jobName: "validate-payment",
    data: { orderId: "ORD-001", amount: 99.99 },
  },
  {
    name: "reserve-inventory",
    queue: "orders",
    jobName: "reserve-inventory",
    data: (prev: any) => ({
      orderId: "ORD-001",
      paymentValidated: prev?.sent ?? true,
    }),
  },
  {
    name: "send-confirmation",
    queue: "orders",
    jobName: "send-confirmation",
    data: (prev: any) => ({
      orderId: "ORD-001",
      inventoryReserved: prev?.reserved ?? true,
    }),
  },
]

/** Saga order processing — each step has a compensation action for rollback */
export const sagaOrderSteps: WorkflowStep[] = [
  {
    name: "charge-payment",
    queue: "orders",
    jobName: "charge-payment",
    data: { orderId: "ORD-002", amount: 49.99 },
    compensation: {
      queue: "orders",
      jobName: "refund-payment",
      data: { orderId: "ORD-002" },
    },
  },
  {
    name: "ship-order",
    queue: "orders",
    jobName: "ship-order",
    data: (prev: any) => ({
      orderId: "ORD-002",
      paymentId: prev?.chargeId ?? "chg-1",
    }),
    compensation: {
      queue: "orders",
      jobName: "cancel-shipment",
      data: { orderId: "ORD-002" },
    },
  },
  {
    name: "send-receipt",
    queue: "orders",
    jobName: "send-receipt",
    data: { orderId: "ORD-002" },
    // no compensation — receipts are idempotent
  },
]

/** Parallel report generation — all steps run independently */
export const reportGenerationSteps: WorkflowStep[] = [
  {
    name: "sales-report",
    queue: "reports",
    jobName: "generate-sales-report",
    data: { period: "2024-Q1" },
  },
  {
    name: "inventory-report",
    queue: "reports",
    jobName: "generate-inventory-report",
    data: { period: "2024-Q1" },
  },
  {
    name: "customer-report",
    queue: "reports",
    jobName: "generate-customer-report",
    data: { period: "2024-Q1" },
  },
]
