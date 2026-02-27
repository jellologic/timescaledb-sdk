import { Expression } from "../query/Expression.js"
import type { ColumnDef } from "../schema/types.js"

const colRef = (col: ColumnDef<any> | Expression<any> | string): string => {
  if (col instanceof Expression) return col.sql
  if (typeof col === "string") return `"${col.replace(/"/g, '""')}"`
  return `"${col.name.replace(/"/g, '""')}"`
}

export class StatsAggExpression extends Expression<unknown> {
  constructor(col: ColumnDef<number> | Expression<number> | string) {
    super(`stats_agg(${colRef(col)})`)
  }

  average(): Expression<number> {
    return new Expression<number>(`average(${this.sql})`, this.params)
  }

  stddev(): Expression<number> {
    return new Expression<number>(`stddev(${this.sql})`, this.params)
  }

  variance(): Expression<number> {
    return new Expression<number>(`variance(${this.sql})`, this.params)
  }

  numVals(): Expression<number> {
    return new Expression<number>(`num_vals(${this.sql})`, this.params)
  }

  kurtosis(): Expression<number> {
    return new Expression<number>(`kurtosis(${this.sql})`, this.params)
  }

  skewness(): Expression<number> {
    return new Expression<number>(`skewness(${this.sql})`, this.params)
  }

  sum(): Expression<number> {
    return new Expression<number>(`sum(${this.sql})`, this.params)
  }
}

export class StatsAgg2DExpression extends Expression<unknown> {
  constructor(
    y: ColumnDef<number> | Expression<number> | string,
    x: ColumnDef<number> | Expression<number> | string,
  ) {
    super(`stats_agg(${colRef(y)}, ${colRef(x)})`)
  }

  average(): { x: Expression<number>; y: Expression<number> } {
    return {
      x: new Expression<number>(`average_x(${this.sql})`, this.params),
      y: new Expression<number>(`average_y(${this.sql})`, this.params),
    }
  }

  stddev(): { x: Expression<number>; y: Expression<number> } {
    return {
      x: new Expression<number>(`stddev_x(${this.sql})`, this.params),
      y: new Expression<number>(`stddev_y(${this.sql})`, this.params),
    }
  }

  variance(): { x: Expression<number>; y: Expression<number> } {
    return {
      x: new Expression<number>(`variance_x(${this.sql})`, this.params),
      y: new Expression<number>(`variance_y(${this.sql})`, this.params),
    }
  }

  numVals(): Expression<number> {
    return new Expression<number>(`num_vals(${this.sql})`, this.params)
  }

  slope(): Expression<number> {
    return new Expression<number>(`slope(${this.sql})`, this.params)
  }

  intercept(): Expression<number> {
    return new Expression<number>(`intercept(${this.sql})`, this.params)
  }

  corr(): Expression<number> {
    return new Expression<number>(`corr(${this.sql})`, this.params)
  }

  covariance(): Expression<number> {
    return new Expression<number>(`covariance(${this.sql})`, this.params)
  }

  determinationCoeff(): Expression<number> {
    return new Expression<number>(`determination_coeff(${this.sql})`, this.params)
  }

  kurtosis(): { x: Expression<number>; y: Expression<number> } {
    return {
      x: new Expression<number>(`kurtosis_x(${this.sql})`, this.params),
      y: new Expression<number>(`kurtosis_y(${this.sql})`, this.params),
    }
  }

  skewness(): { x: Expression<number>; y: Expression<number> } {
    return {
      x: new Expression<number>(`skewness_x(${this.sql})`, this.params),
      y: new Expression<number>(`skewness_y(${this.sql})`, this.params),
    }
  }

  sum(): { x: Expression<number>; y: Expression<number> } {
    return {
      x: new Expression<number>(`sum_x(${this.sql})`, this.params),
      y: new Expression<number>(`sum_y(${this.sql})`, this.params),
    }
  }
}

export const statsAgg = (col: ColumnDef<number> | Expression<number> | string): StatsAggExpression =>
  new StatsAggExpression(col)

export const statsAgg2D = (
  y: ColumnDef<number> | Expression<number> | string,
  x: ColumnDef<number> | Expression<number> | string,
): StatsAgg2DExpression => new StatsAgg2DExpression(y, x)
