import type { PlanCategory } from '../../types'

export const CATEGORY_BG: Record<PlanCategory, string> = {
  morning_routine: '#FFF3BF',
  school:          '#D0EBFF',
  homework:        '#E5DBFF',
  afterschool:     '#D3F9D8',
  evening_routine: '#EDE9FE',
  meal:            '#FFE8CC',
}

export const CATEGORY_BORDER: Record<PlanCategory, string> = {
  morning_routine: '#FFD43B',
  school:          '#74C0FC',
  homework:        '#B197FC',
  afterschool:     '#69DB7C',
  evening_routine: '#C5B4F5',
  meal:            '#FFA94D',
}

export const CATEGORY_LABEL: Record<PlanCategory, string> = {
  morning_routine: 'Morning',
  school:          'School',
  homework:        'Homework',
  afterschool:     'Play',
  evening_routine: 'Evening',
  meal:            'Meal',
}

export const CATEGORY_OPTIONS: { value: PlanCategory; label: string }[] = [
  { value: 'morning_routine', label: 'Morning Routine' },
  { value: 'meal',            label: 'Meal / Snack' },
  { value: 'school',          label: 'School' },
  { value: 'homework',        label: 'Homework / Learning' },
  { value: 'afterschool',     label: 'After School / Play' },
  { value: 'evening_routine', label: 'Evening Routine' },
]
