export type PlayerPosition = 'Goalkeeper' | 'Defender' | 'Midfielder' | 'Forward'

export type PlayerPerformance = {
  position: PlayerPosition
  minutesPlayed: number
  goalsScored: number
  assists: number
  cleanSheet: boolean
  shotSaves: number
  defensiveContributions: number // CBI + Tackles (or CBI + Tackles + Recoveries for mid/fwd)
  penaltySaves: number
  penaltyMisses: number
  goalsConceded: number
  yellowCards: number
  redCards: number
  ownGoals: number
  bonusPoints: number
}

export function calculatePlayerPoints(performance: PlayerPerformance): { points: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {}
  let points = 0

  // Playing time (1 or 2 points)
  const playingTimePoints = performance.minutesPlayed >= 60 ? 2 : performance.minutesPlayed > 0 ? 1 : 0
  if (playingTimePoints > 0) {
    breakdown['Playing Time'] = playingTimePoints
    points += playingTimePoints
  }

  // Goals scored
  const goalPoints = getGoalPoints(performance.position, performance.goalsScored)
  if (goalPoints > 0) {
    breakdown['Goals'] = goalPoints
    points += goalPoints
  }

  // Assists
  const assistPoints = performance.assists * 3
  if (assistPoints > 0) {
    breakdown['Assists'] = assistPoints
    points += assistPoints
  }

  // Clean sheet (only if 60+ minutes)
  if (performance.cleanSheet && performance.minutesPlayed >= 60) {
    const cleanSheetPoints = getCleanSheetPoints(performance.position)
    if (cleanSheetPoints > 0) {
      breakdown['Clean Sheet'] = cleanSheetPoints
      points += cleanSheetPoints
    }
  }

  // Shot saves (goalkeeper only, 1 point per 3 saves)
  if (performance.position === 'Goalkeeper') {
    const savePoints = Math.floor(performance.shotSaves / 3)
    if (savePoints > 0) {
      breakdown['Shot Saves'] = savePoints
      points += savePoints
    }
  }

  // Defensive contributions
  const defensePoints = getDefensiveContributionPoints(performance.position, performance.defensiveContributions)
  if (defensePoints > 0) {
    breakdown['Defensive Contributions'] = defensePoints
    points += defensePoints
  }

  // Penalty saves
  const penaltySavePoints = performance.penaltySaves * 5
  if (penaltySavePoints > 0) {
    breakdown['Penalty Saves'] = penaltySavePoints
    points += penaltySavePoints
  }

  // Penalty misses
  const penaltyMissPoints = performance.penaltyMisses * -2
  if (penaltyMissPoints < 0) {
    breakdown['Penalty Misses'] = penaltyMissPoints
    points += penaltyMissPoints
  }

  // Goals conceded (goalkeeper & defender only, -1 per 2 goals)
  if (performance.position === 'Goalkeeper' || performance.position === 'Defender') {
    const concededPoints = Math.floor(performance.goalsConceded / 2) * -1
    if (concededPoints < 0) {
      breakdown['Goals Conceded'] = concededPoints
      points += concededPoints
    }
  }

  // Yellow cards
  const yellowCardPoints = performance.yellowCards * -1
  if (yellowCardPoints < 0) {
    breakdown['Yellow Cards'] = yellowCardPoints
    points += yellowCardPoints
  }

  // Red cards (includes yellow card deduction)
  const redCardPoints = performance.redCards * -3
  if (redCardPoints < 0) {
    breakdown['Red Cards'] = redCardPoints
    points += redCardPoints
  }

  // Own goals
  const ownGoalPoints = performance.ownGoals * -2
  if (ownGoalPoints < 0) {
    breakdown['Own Goals'] = ownGoalPoints
    points += ownGoalPoints
  }

  // Bonus points
  if (performance.bonusPoints > 0) {
    breakdown['Bonus Points'] = performance.bonusPoints
    points += performance.bonusPoints
  }

  return { points, breakdown }
}

function getGoalPoints(position: PlayerPosition, goals: number): number {
  if (goals === 0) return 0

  const pointsPerGoal: Record<PlayerPosition, number> = {
    Goalkeeper: 10,
    Defender: 6,
    Midfielder: 5,
    Forward: 4,
  }

  return goals * (pointsPerGoal[position] ?? 0)
}

function getCleanSheetPoints(position: PlayerPosition): number {
  if (position === 'Goalkeeper' || position === 'Defender') {
    return 4
  }
  if (position === 'Midfielder') {
    return 1
  }
  return 0
}

function getDefensiveContributionPoints(position: PlayerPosition, contributions: number): number {
  if (position === 'Defender' && contributions >= 10) {
    return 2
  }
  if ((position === 'Midfielder' || position === 'Forward') && contributions >= 12) {
    return 2
  }
  return 0
}

export function getPointsBreakdownText(breakdown: Record<string, number>): string {
  return Object.entries(breakdown)
    .map(([key, value]) => {
      if (value > 0) return `${key}: +${value}`
      return `${key}: ${value}`
    })
    .join(' | ')
}
