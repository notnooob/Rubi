import assert from "node:assert/strict"
import {describe, it} from "node:test"
import {convertUnits, findUnit, formatUnitNumber, UnitError, unitReference} from "../src/util/units"
import {parseConversion} from "../data/commands/utility/convert"
import {dm, groupMsg, makeHarness} from "./helpers/fake"

const close = (actual: number, expected: number, epsilon = 1e-10) => assert.ok(Math.abs(actual - expected) <= epsilon * Math.max(1, Math.abs(expected)), `${actual} ≠ ${expected}`)

describe("unit lookup", () => {
  it("resolves symbols, full names, plurals, and natural spellings", () => {
    assert.equal(findUnit("m")!.symbol, "m")
    assert.equal(findUnit("metres")!.symbol, "m")
    assert.equal(findUnit("KILOMETERS")!.symbol, "km")
    assert.equal(findUnit("fl oz")!.category, "volume")
    assert.equal(findUnit("fluidounces")!.symbol, "fl oz")
    assert.equal(findUnit("square metres")!.symbol, "m²")
    assert.equal(findUnit("degrees C")!.symbol, "C")
    assert.equal(findUnit("degrees fahrenheit")!.symbol, "F")
    assert.equal(findUnit("not-a-unit"), undefined)
  })

  it("uses sensible case rules for temperature and digital data", () => {
    for (const name of ["C", "c", "°C", "Celsius"]) assert.equal(findUnit(name)!.symbol, "C")
    for (const name of ["F", "f", "°F", "Fahrenheit"]) assert.equal(findUnit(name)!.symbol, "F")
    for (const name of ["K", "k", "Kelvin"]) assert.equal(findUnit(name)!.symbol, "K")
    assert.equal(findUnit("MB")!.factor, 1_000_000)
    assert.equal(findUnit("mb")!.factor, 1_000_000)
    assert.equal(findUnit("MiB")!.factor, 1024 ** 2)
    assert.equal(findUnit("mib")!.factor, 1024 ** 2)
    assert.equal(findUnit("B")!.symbol, "B")
    assert.equal(findUnit("b")!.symbol, "bit")
    assert.equal(findUnit("Cal")!.symbol, "kcal")
    assert.equal(findUnit("cal")!.symbol, "cal")
  })
})

describe("unit conversion", () => {
  it("converts metric and imperial length and mass", () => {
    close(convertUnits(1, "km", "m").value, 1000)
    close(convertUnits(12, "in", "ft").value, 1)
    close(convertUnits(1, "mile", "km").value, 1.609344)
    close(convertUnits(1, "nmi", "m").value, 1852)
    close(convertUnits(1, "lb", "kg").value, 0.45359237)
    close(convertUnits(1, "kg", "g").value, 1000)
    close(convertUnits(16, "ounces", "pounds").value, 1)
    close(convertUnits(1, "tonne", "kg").value, 1000)
    close(convertUnits(1, "ton", "lb").value, 2000)
  })

  it("handles affine temperature conversions in both directions", () => {
    close(convertUnits(0, "C", "F").value, 32)
    close(convertUnits(100, "C", "F").value, 212)
    close(convertUnits(32, "F", "C").value, 0)
    close(convertUnits(-40, "C", "F").value, -40)
    close(convertUnits(-40, "F", "C").value, -40)
    close(convertUnits(0, "C", "K").value, 273.15)
    close(convertUnits(0, "K", "C").value, -273.15)
    close(convertUnits(32, "F", "K").value, 273.15)
    close(convertUnits(300, "K", "F").value, 80.33)
    close(convertUnits(212, "fahrenheit", "celsius").value, 100)
    assert.equal(convertUnits(25, "C", "C").value, 25)
  })

  it("converts area and US/imperial cooking volumes", () => {
    close(convertUnits(1, "m2", "cm²").value, 10_000)
    close(convertUnits(1, "acre", "m²").value, 4046.8564224)
    close(convertUnits(1, "ft²", "in2").value, 144)
    close(convertUnits(1, "L", "mL").value, 1000)
    close(convertUnits(1, "cup", "mL").value, 236.5882365)
    close(convertUnits(1, "tbsp", "tsp").value, 3)
    close(convertUnits(1, "fl oz", "tbsp").value, 2)
    close(convertUnits(1, "gal", "cups").value, 16)
    close(convertUnits(1, "imp gal", "L").value, 4.54609)
    close(convertUnits(1, "m3", "L").value, 1000)
  })

  it("converts speed, time, and digital data", () => {
    close(convertUnits(100, "km/h", "m/s").value, 27.7777777778)
    close(convertUnits(60, "mph", "km/h").value, 96.56064)
    close(convertUnits(1, "knot", "km/h").value, 1.852)
    close(convertUnits(2, "h", "min").value, 120)
    close(convertUnits(1, "week", "days").value, 7)
    close(convertUnits(1, "ms", "µs").value, 1000)
    close(convertUnits(1, "MB", "kB").value, 1000)
    close(convertUnits(1, "MiB", "KiB").value, 1024)
    close(convertUnits(1, "GiB", "MiB").value, 1024)
    close(convertUnits(8, "bits", "B").value, 1)
    close(convertUnits(1, "byte", "bit").value, 8)
  })

  it("converts energy, power, pressure, and angle", () => {
    close(convertUnits(1, "kcal", "J").value, 4184)
    close(convertUnits(1, "kWh", "MJ").value, 3.6)
    close(convertUnits(1, "Wh", "J").value, 3600)
    close(convertUnits(1, "BTU", "J").value, 1055.05585262)
    close(convertUnits(1, "hp", "W").value, 745.6998715822702)
    close(convertUnits(1, "kW", "W").value, 1000)
    close(convertUnits(1, "atm", "kPa").value, 101.325)
    close(convertUnits(1, "bar", "Pa").value, 100_000)
    close(convertUnits(14.6959487755, "psi", "atm").value, 1)
    close(convertUnits(180, "deg", "rad").value, Math.PI)
    close(convertUnits(Math.PI, "radians", "degrees").value, 180)
    close(convertUnits(1, "turn", "deg").value, 360)
    close(convertUnits(1, "degree", "arcmin").value, 60)
  })

  it("reports unknown and incompatible units clearly", () => {
    assert.throws(() => convertUnits(1, "bogus", "m"), (e) => e instanceof UnitError && /Unknown unit "bogus"/.test(e.message))
    assert.throws(() => convertUnits(1, "m", "bogus"), /Unknown unit "bogus"/)
    assert.throws(() => convertUnits(1, "m", "kg"), /Can't convert m \(length\) to kg \(mass\)/)
    assert.throws(() => convertUnits(Infinity, "m", "ft"), /finite number/)
  })

  it("preserves tiny nonzero values and finite identity conversions", () => {
    const electronVolt = convertUnits(1, "eV", "J").value
    const petabyte = convertUnits(1, "B", "PB").value
    const nanoseconds = convertUnits(1, "ns", "h").value
    assert.ok(electronVolt > 0 && electronVolt < 1e-18)
    assert.ok(petabyte > 0 && petabyte < 1e-14)
    assert.ok(nanoseconds > 0 && nanoseconds < 1e-12)
    assert.equal(convertUnits(1e308, "m", "m").value, 1e308)
  })
})

describe("unit number formatting and reference", () => {
  it("formats large, small, negative and rounded values without scientific-notation surprises", () => {
    assert.equal(formatUnitNumber(0), "0")
    assert.equal(formatUnitNumber(-0), "0")
    assert.equal(formatUnitNumber(1234567.891), "1,234,567.891")
    assert.equal(formatUnitNumber(0.000001234567890123), "0.00000123456789012")
    assert.match(formatUnitNumber(1e20), /^1e\+20$/)
    assert.match(formatUnitNumber(1e-12), /^1e-12$/)
    assert.equal(formatUnitNumber(1 / 3), "0.333333333333")
    assert.throws(() => formatUnitNumber(NaN), UnitError)
  })

  it("lists every category with a compact set of examples", () => {
    const reference = unitReference()
    for (const category of ["length", "mass", "temperature", "area", "volume", "speed", "time", "data", "energy", "power", "pressure", "angle"]) assert.match(reference, new RegExp(`^${category}:`, "m"))
    assert.ok(reference.split("\n").length <= 12)
    assert.match(reference, /tsp, tbsp/)
  })
})

describe("/convert command", () => {
  it("converts comma-separated numbers, optional 'to', full names, and groups", async () => {
    const h = makeHarness()
    assert.ok(h.rt.commands.get("convert"))
    await h.receive(dm("/convert 1,000 m to ft"))
    assert.match(h.chat.last()!.text!, /1,000 m.*=.*3,280\.83989501 ft/)
    await h.receive(dm("/convert 2 cups mL", {contactId: 8}))
    assert.match(h.chat.last()!.text!, /2 cup.*=.*473\.176473 mL/)
    await h.receive(groupMsg("/convert 100 kilometers miles", {menu: true}))
    assert.match(h.chat.last()!.text!, /100 km.*=.*62\.1371192237 mi/)
    assert.equal(h.chat.last()!.kind, "send")
    assert.equal(h.chat.last()!.live, false)
  })

  it("supports temperatures, symbols and compact number-unit input", async () => {
    const h = makeHarness()
    await h.receive(dm("/convert 32 F C"))
    assert.match(h.chat.last()!.text!, /32 F.*=.*0 C/)
    await h.receive(dm("/convert 100°C F", {contactId: 8}))
    assert.match(h.chat.last()!.text!, /100 C.*=.*212 F/)
    await h.receive(dm("/convert 1 GiB MB", {contactId: 9}))
    assert.match(h.chat.last()!.text!, /1 GiB.*=.*1,073\.741824 MB/)
  })

  it("shows a concise units reference", async () => {
    const h = makeHarness()
    await h.receive(dm("/convert units"))
    const text = h.chat.last()!.text!
    assert.match(text, /Unit conversion \(offline\)/)
    assert.match(text, /temperature: C, F, K/)
    assert.match(text, /volume:/)
    assert.match(text, /pressure:/)
    assert.ok(text.length < 1600)
  })

  it("returns friendly errors for unknown, incompatible and malformed input", async () => {
    const h = makeHarness()
    await h.receive(dm("/convert 1 m kg"))
    assert.match(h.chat.last()!.text!, /^❌ Can't convert m \(length\) to kg \(mass\)/)
    await h.receive(dm("/convert 1 blorp m", {contactId: 8}))
    assert.match(h.chat.last()!.text!, /^❌ Unknown unit "blorp"/)
    await h.receive(dm("/convert nonsense", {contactId: 9}))
    assert.match(h.chat.last()!.text!, /^❌ Use <amount>/)
    await h.receive(dm("/convert 1 m", {contactId: 10}))
    assert.match(h.chat.last()!.text!, /^❌ Use <amount>/)
  })

  it("parses arrows, multi-word names and validates amounts", () => {
    assert.deepEqual(parseConversion("1,234.5 kilometers to miles"), {amount: 1234.5, from: "kilometers", to: "miles"})
    assert.deepEqual(parseConversion("2 imperial gallons L"), {amount: 2, from: "imperial gallons", to: "L"})
    assert.deepEqual(parseConversion("10 km→mi"), {amount: 10, from: "km", to: "mi"})
    assert.deepEqual(parseConversion("-40 degrees F C"), {amount: -40, from: "degrees F", to: "C"})
    assert.deepEqual(parseConversion("12 in cm"), {amount: 12, from: "in", to: "cm"})
    assert.deepEqual(parseConversion("12 in to cm"), {amount: 12, from: "in", to: "cm"})
    assert.deepEqual(parseConversion("2 fl oz in mL"), {amount: 2, from: "fl oz", to: "mL"})
    assert.equal(parseConversion("NaN m ft"), undefined)
    assert.equal(parseConversion("Infinity m ft"), undefined)
    assert.equal(parseConversion("1e999 m ft"), undefined)
    assert.equal(parseConversion("1 m"), undefined)
  })
})
