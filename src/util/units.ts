export type UnitCategory = "length" | "mass" | "temperature" | "area" | "volume" | "speed" | "time" | "data" | "energy" | "power" | "pressure" | "angle"

export interface Unit {
  symbol: string
  names: string[]
  /** Value in the category's base unit, or a conversion to/from that unit. */
  factor?: number
  toBase?: (value: number) => number
  fromBase?: (value: number) => number
}

interface UnitDefinition extends Unit {
  category: UnitCategory
}

export class UnitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UnitError"
  }
}

const unit = (category: UnitCategory, symbol: string, names: string[], factor: number): UnitDefinition => ({category, symbol, names, factor})

const definitions: UnitDefinition[] = [
  // Length — metres
  unit("length", "mm", ["millimeter", "millimeters", "millimetre", "millimetres"], 0.001),
  unit("length", "cm", ["centimeter", "centimeters", "centimetre", "centimetres"], 0.01),
  unit("length", "m", ["meter", "meters", "metre", "metres"], 1),
  unit("length", "km", ["kilometer", "kilometers", "kilometre", "kilometres"], 1000),
  unit("length", "in", ["inch", "inches", '"', "″"], 0.0254),
  unit("length", "ft", ["foot", "feet", "'", "′"], 0.3048),
  unit("length", "yd", ["yard", "yards"], 0.9144),
  unit("length", "mi", ["mile", "miles"], 1609.344),
  unit("length", "nmi", ["nauticalmile", "nauticalmiles"], 1852),

  // Mass — kilograms
  unit("mass", "mg", ["milligram", "milligrams"], 0.000001),
  unit("mass", "g", ["gram", "grams"], 0.001),
  unit("mass", "kg", ["kilogram", "kilograms"], 1),
  unit("mass", "t", ["tonne", "tonnes", "metricton", "metrictons"], 1000),
  unit("mass", "oz", ["ounce", "ounces"], 0.028349523125),
  unit("mass", "lb", ["lbs", "pound", "pounds"], 0.45359237),
  unit("mass", "st", ["stone", "stones"], 6.35029318),
  unit("mass", "ton", ["tons", "shortton", "shorttons", "uston", "ustons"], 907.18474),
  unit("mass", "long ton", ["longton", "longtons", "imperialton", "imperialtons"], 1016.0469088),

  // Temperature — kelvin; unlike the other categories, these are affine.
  {category: "temperature", symbol: "C", names: ["c", "°c", "degc", "degreesc", "celsius", "degreecelsius", "degreescelsius"], toBase: (v) => v + 273.15, fromBase: (v) => v - 273.15},
  {category: "temperature", symbol: "F", names: ["f", "°f", "degf", "degreesf", "fahrenheit", "degreefahrenheit", "degreesfahrenheit"], toBase: (v) => (v + 459.67) * (5 / 9), fromBase: (v) => v * (9 / 5) - 459.67},
  {category: "temperature", symbol: "K", names: ["k", "kelvin", "kelvins"], toBase: (v) => v, fromBase: (v) => v},

  // Area — square metres
  unit("area", "mm²", ["mm2", "mm^2", "sqmm", "squaremillimeter", "squaremillimeters", "squaremillimetre", "squaremillimetres"], 0.000001),
  unit("area", "cm²", ["cm2", "cm^2", "sqcm", "squarecentimeter", "squarecentimeters", "squarecentimetre", "squarecentimetres"], 0.0001),
  unit("area", "m²", ["m2", "m^2", "sqm", "squaremeter", "squaremeters", "squaremetre", "squaremetres"], 1),
  unit("area", "km²", ["km2", "km^2", "sqkm", "squarekilometer", "squarekilometers", "squarekilometre", "squarekilometres"], 1_000_000),
  unit("area", "ha", ["hectare", "hectares"], 10_000),
  unit("area", "in²", ["in2", "in^2", "sqin", "squareinch", "squareinches"], 0.00064516),
  unit("area", "ft²", ["ft2", "ft^2", "sqft", "squarefoot", "squarefeet"], 0.09290304),
  unit("area", "yd²", ["yd2", "yd^2", "sqyd", "squareyard", "squareyards"], 0.83612736),
  unit("area", "ac", ["acre", "acres"], 4046.8564224),
  unit("area", "mi²", ["mi2", "mi^2", "sqmi", "squaremile", "squaremiles"], 2_589_988.110336),

  // Volume — litres; US cooking/customary units unless marked imperial.
  unit("volume", "mL", ["ml", "milliliter", "milliliters", "millilitre", "millilitres", "cc"], 0.001),
  unit("volume", "cL", ["cl", "centiliter", "centiliters", "centilitre", "centilitres"], 0.01),
  unit("volume", "dL", ["dl", "deciliter", "deciliters", "decilitre", "decilitres"], 0.1),
  unit("volume", "L", ["l", "liter", "liters", "litre", "litres"], 1),
  unit("volume", "m³", ["m3", "m^3", "cubicmeter", "cubicmeters", "cubicmetre", "cubicmetres"], 1000),
  unit("volume", "tsp", ["tsps", "teaspoon", "teaspoons", "ustsp", "usteaspoon", "usteaspoons"], 0.00492892159375),
  unit("volume", "tbsp", ["tbsps", "tablespoon", "tablespoons", "ustbsp", "ustablespoon", "ustablespoons"], 0.01478676478125),
  unit("volume", "fl oz", ["floz", "fluidounce", "fluidounces", "usfloz", "usfluidounce", "usfluidounces"], 0.0295735295625),
  unit("volume", "cup", ["cups", "uscup", "uscups"], 0.2365882365),
  unit("volume", "pt", ["pint", "pints", "uspt", "uspint", "uspints"], 0.473176473),
  unit("volume", "qt", ["quart", "quarts", "usqt", "usquart", "usquarts"], 0.946352946),
  unit("volume", "gal", ["gallon", "gallons", "usgal", "usgallon", "usgallons"], 3.785411784),
  unit("volume", "in³", ["in3", "in^3", "cuin", "cubicinch", "cubicinches"], 0.016387064),
  unit("volume", "ft³", ["ft3", "ft^3", "cuft", "cubicfoot", "cubicfeet"], 28.316846592),
  unit("volume", "imp tsp", ["imperialteaspoon", "imperialteaspoons"], 0.005919388020833333),
  unit("volume", "imp tbsp", ["imperialtablespoon", "imperialtablespoons"], 0.0177581640625),
  unit("volume", "imp fl oz", ["impfloz", "imperialfluidounce", "imperialfluidounces"], 0.0284130625),
  unit("volume", "imp pt", ["imppint", "imppints", "imperialpint", "imperialpints"], 0.56826125),
  unit("volume", "imp qt", ["impquart", "impquarts", "imperialquart", "imperialquarts"], 1.1365225),
  unit("volume", "imp gal", ["impgal", "impgallon", "impgallons", "imperialgallon", "imperialgallons", "ukgal", "ukgallon", "ukgallons"], 4.54609),

  // Speed — metres per second
  unit("speed", "m/s", ["mps", "meterpersecond", "meterspersecond", "metrepersecond", "metrespersecond"], 1),
  unit("speed", "km/h", ["kmh", "kph", "kmph", "kilometerperhour", "kilometersperhour", "kilometreperhour", "kilometresperhour"], 1 / 3.6),
  unit("speed", "mph", ["mi/h", "mileperhour", "milesperhour"], 0.44704),
  unit("speed", "ft/s", ["fps", "footpersecond", "feetpersecond"], 0.3048),
  unit("speed", "kn", ["kt", "kts", "knot", "knots"], 1852 / 3600),
  unit("speed", "Mach", ["mach", "machnumber"], 340.29),

  // Time — seconds
  unit("time", "ms", ["millisecond", "milliseconds"], 0.001),
  unit("time", "µs", ["us", "μs", "microsecond", "microseconds"], 0.000001),
  unit("time", "ns", ["nanosecond", "nanoseconds"], 0.000000001),
  unit("time", "s", ["sec", "secs", "second", "seconds"], 1),
  unit("time", "min", ["mins", "minute", "minutes"], 60),
  unit("time", "h", ["hr", "hrs", "hour", "hours"], 3600),
  unit("time", "d", ["day", "days"], 86_400),
  unit("time", "wk", ["wks", "week", "weeks"], 604_800),
  unit("time", "mo", ["month", "months"], 2_629_746), // mean Gregorian month
  unit("time", "yr", ["yrs", "year", "years"], 31_556_952), // mean Gregorian year

  // Digital information — bytes; SI prefixes are decimal, IEC prefixes binary.
  unit("data", "bit", ["bits", "b"], 1 / 8),
  unit("data", "B", ["byte", "bytes"], 1),
  unit("data", "kB", ["kb", "kilobyte", "kilobytes"], 1000),
  unit("data", "MB", ["mb", "megabyte", "megabytes"], 1000 ** 2),
  unit("data", "GB", ["gb", "gigabyte", "gigabytes"], 1000 ** 3),
  unit("data", "TB", ["tb", "terabyte", "terabytes"], 1000 ** 4),
  unit("data", "PB", ["pb", "petabyte", "petabytes"], 1000 ** 5),
  unit("data", "KiB", ["kib", "kibibyte", "kibibytes"], 1024),
  unit("data", "MiB", ["mib", "mebibyte", "mebibytes"], 1024 ** 2),
  unit("data", "GiB", ["gib", "gibibyte", "gibibytes"], 1024 ** 3),
  unit("data", "TiB", ["tib", "tebibyte", "tebibytes"], 1024 ** 4),
  unit("data", "PiB", ["pib", "pebibyte", "pebibytes"], 1024 ** 5),

  // Energy — joules
  unit("energy", "J", ["j", "joule", "joules"], 1),
  unit("energy", "kJ", ["kj", "kilojoule", "kilojoules"], 1000),
  unit("energy", "MJ", ["mj", "megajoule", "megajoules"], 1_000_000),
  unit("energy", "cal", ["cals", "calorie", "calories", "thermochemicalcalorie", "thermochemicalcalories"], 4.184),
  unit("energy", "kcal", ["Cal", "foodcalorie", "foodcalories", "kilocalorie", "kilocalories"], 4184),
  unit("energy", "Wh", ["watthour", "watthours"], 3600),
  unit("energy", "kWh", ["kwh", "kilowatthour", "kilowatthours"], 3_600_000),
  unit("energy", "BTU", ["btu", "btus", "britishthermalunit", "britishthermalunits"], 1055.05585262),
  unit("energy", "ft·lb", ["ftlb", "ft-lb", "footpound", "footpounds"], 1.3558179483314004),
  unit("energy", "eV", ["ev", "electronvolt", "electronvolts"], 1.602176634e-19),

  // Power — watts
  unit("power", "W", ["w", "watt", "watts"], 1),
  unit("power", "kW", ["kw", "kilowatt", "kilowatts"], 1000),
  unit("power", "MW", ["mw", "megawatt", "megawatts"], 1_000_000),
  unit("power", "hp", ["horsepower", "mechanichorsepower", "mechanicalhorsepower"], 745.69987158227022),
  unit("power", "PS", ["ps", "metrichorsepower", "pferdestarke", "pferdestärke"], 735.49875),
  unit("power", "BTU/h", ["btuh", "btu/hr", "btuperhour", "btusperhour"], 1055.05585262 / 3600),

  // Pressure — pascals
  unit("pressure", "Pa", ["pa", "pascal", "pascals"], 1),
  unit("pressure", "hPa", ["hpa", "hectopascal", "hectopascals"], 100),
  unit("pressure", "kPa", ["kpa", "kilopascal", "kilopascals"], 1000),
  unit("pressure", "MPa", ["mpa", "megapascal", "megapascals"], 1_000_000),
  unit("pressure", "bar", ["bars"], 100_000),
  unit("pressure", "mbar", ["millibar", "millibars"], 100),
  unit("pressure", "atm", ["atmosphere", "atmospheres"], 101_325),
  unit("pressure", "psi", ["poundpersquareinch", "poundspersquareinch"], 6894.757293168361),
  unit("pressure", "mmHg", ["mmhg", "torr"], 133.322387415),
  unit("pressure", "inHg", ["inhg", "inchofmercury", "inchesofmercury"], 3386.389),

  // Angle — degrees
  unit("angle", "°", ["deg", "degree", "degrees"], 1),
  unit("angle", "rad", ["radian", "radians"], 180 / Math.PI),
  unit("angle", "grad", ["gon", "gradian", "gradians"], 0.9),
  unit("angle", "turn", ["turns", "revolution", "revolutions", "rev"], 360),
  unit("angle", "arcmin", ["arcminute", "arcminutes", "′"], 1 / 60),
  unit("angle", "arcsec", ["arcsecond", "arcseconds", "″"], 1 / 3600),
]

const aliases: Record<string, UnitDefinition> = {}
const caseInsensitive = new Set<UnitCategory>(["length", "mass", "area", "speed", "time", "angle"])
const temperatures = new Set(definitions.filter((d) => d.category === "temperature").map((d) => d.symbol))

for (const definition of definitions) {
  for (const name of [definition.symbol, ...definition.names]) {
    const keys = [name, normalizeName(name)]
    if (caseInsensitive.has(definition.category)) keys.push(name.toLowerCase(), normalizeName(name.toLowerCase()))
    for (const key of keys) {
      const previous = aliases[key]
      if (previous && previous !== definition) {
        // A prime/double prime is conventionally feet/inches, not arcminutes/arcseconds.
        if (definition.symbol === "arcmin" || definition.symbol === "arcsec") continue
        throw new Error(`Duplicate unit alias: ${name}`)
      }
      aliases[key] = definition
    }
  }
}

function normalizeName(name: string): string {
  return name.replace(/[\s._-]+/g, "").replace(/²/g, "2").replace(/³/g, "3")
}

/** Resolve a symbol, abbreviation or full name. Case matters where it changes the unit (mB/MB, C/F/K). */
export function findUnit(input: string): (Unit & {category: UnitCategory}) | undefined {
  const name = input.trim()
  const exact = aliases[name] ?? aliases[normalizeName(name)]
  if (exact) return exact
  const lower = name.toLowerCase()
  const folded = aliases[lower] ?? aliases[normalizeName(lower)]
  if (folded) return folded
  // Natural "degrees C/F" spellings are accepted without making celsius/fahrenheit case-sensitive.
  const degree = lower.match(/^(?:degree|degrees)\s+([cf])$/)
  if (degree) return aliases[degree[1] === "c" ? "C" : "F"]
  return undefined
}

/** Convert between compatible units. The result is finite for every finite input supported here. */
export function convertUnits(value: number, fromInput: string, toInput: string): {value: number; from: Unit; to: Unit; category: UnitCategory} {
  if (!Number.isFinite(value)) throw new UnitError("The amount must be a finite number.")
  const from = findUnit(fromInput)
  if (!from) throw new UnitError(`Unknown unit "${fromInput}". Try /convert units.`)
  const to = findUnit(toInput)
  if (!to) throw new UnitError(`Unknown unit "${toInput}". Try /convert units.`)
  if (from.category !== to.category) throw new UnitError(`Can't convert ${from.symbol} (${from.category}) to ${to.symbol} (${to.category}). Choose two units from the same category.`)
  const base = from.toBase ? from.toBase(value) : value * from.factor!
  const result = to.fromBase ? to.fromBase(base) : base / to.factor!
  if (!Number.isFinite(result)) throw new UnitError("That conversion is outside the supported numeric range.")
  return {value: cleanZero(result), from, to, category: from.category}
}

function cleanZero(value: number): number {
  return Object.is(value, -0) || Math.abs(value) < 1e-12 ? 0 : value
}

/** Thousands separators, up to 12 significant digits, and exponential notation only at extremes. */
export function formatUnitNumber(value: number): string {
  if (!Number.isFinite(value)) throw new UnitError("The amount must be a finite number.")
  const cleaned = cleanZero(value)
  const magnitude = Math.abs(cleaned)
  if (magnitude !== 0 && (magnitude >= 1e15 || magnitude < 1e-9)) {
    return cleaned.toExponential(10).replace(/\.?0+e/, "e").replace(/e([+-])(\d)$/, "e$10$2")
  }
  const rounded = Number(cleaned.toPrecision(12))
  return rounded.toLocaleString("en-US", {useGrouping: true, maximumSignificantDigits: 12})
}

const categoryExamples: Record<UnitCategory, string> = {
  length: "mm, cm, m, km, in, ft, yd, mi, nmi",
  mass: "mg, g, kg, t, oz, lb, st, ton, long ton",
  temperature: "C, F, K (or Celsius, Fahrenheit, Kelvin)",
  area: "m², km², ha, ft², ac, mi²",
  volume: "mL, L, m³, tsp, tbsp, fl oz, cup, pt, qt, gal; imp gal for imperial",
  speed: "m/s, km/h, mph, ft/s, kn, Mach",
  time: "ms, s, min, h, d, wk, mo, yr",
  data: "bit, B, kB, MB, GB, TB, KiB, MiB, GiB, TiB",
  energy: "J, kJ, cal, kcal, Wh, kWh, BTU, eV",
  power: "W, kW, MW, hp, PS, BTU/h",
  pressure: "Pa, kPa, bar, atm, psi, mmHg, inHg",
  angle: "°, rad, grad, turn, arcmin, arcsec",
}

/** A compact reference for /convert units. */
export function unitReference(): string {
  return (Object.keys(categoryExamples) as UnitCategory[]).map((category) => `${category}: ${categoryExamples[category]}`).join("\n")
}

/** Kept internal: ensures temperature symbols remain distinguishable from ordinary lowercase aliases. */
export const temperatureSymbols: readonly string[] = [...temperatures]
