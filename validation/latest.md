# Executed physics validation

Executed: 2026-10-11T01:13:44.427Z. 86/87 checks passed.

| Experiment | Domain | Expected | Measured | Absolute error | Relative error | Tolerance | Result | Assumptions |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 12 V / 6 Ω branch current | electrical | 2 | 2 | 0.000e+0 | 0.000e+0 | 1e-10 | PASS | Ideal source, 6 Ω constant resistance, ideal wires |
| 12 V × 2 A resistive power | electrical | 24 | 24 | 0.000e+0 | 0.000e+0 | 1e-9 | PASS | Independent Ohm-law reference |
| 24 W × 10 s energy | electrical | 240 | 240.00000000000233 | 2.331e-12 | 9.711e-15 | 1e-8 | PASS | Fixed-step rectangular integration; power constant |
| Net electrical power residual | electrical | 0 | 0 | 0.000e+0 | — | 1e-9 | PASS | Independent sum of ideal-source and branch powers |
| Disconnected load current | electrical | 0 | 0 | 0.000e+0 | — | 1e-10 | PASS | Open circuit, no leakage model |
| 10 L water heated 20→80°C (9.982071 kg) | thermal | 2503503.4068 | 2503505.708998064 | 2.302e+0 | 9.196e-7 | 33.33433333333333 | PASS | Step crossing bounded by one interval of ≤2 kW input; heater storage accounted separately |
| Isolated coupled heating conservation | coupling | 0 | -0.000020655803382396698 | 2.066e-5 | — | 0.001 | PASS | Backward Euler symmetric immersion transfer; tolerance 1 mJ over ~2.5 MJ |
| OFF removes new electrical energy | coupling | 2525689.691076456 | 2525689.691076456 | 0.000e+0 | 0.000e+0 | 1e-8 | PASS | Stored thermal energy remains, heater electrical branch failed open |
| Thermal inertia still warms water | coupling | 1 | 1 | 0.000e+0 | 0.000e+0 | 0 | PASS | Hot element retains sensible energy after power removal |
| Ambient cooling convergence dt=0.100000 s | thermal | 78.08161478024645 | 78.08161989115646 | 5.111e-6 | 6.546e-8 | 0.0000052950314135524786 | PASS | Analytic exponential cooling with conserved initial water mass; first-order BE error bound ΔT λ² t dt / 2 |
| Cooling conservation dt=0.100000 s | thermal | 0 | 5.55693986825645e-7 | 5.557e-7 | — | 0.001 | PASS | Signed external heat and stored thermal change; no power source |
| Ambient cooling convergence dt=0.050000 s | thermal | 78.08161478024645 | 78.08161733576587 | 2.556e-6 | 3.273e-8 | 0.0000026525157067762392 | PASS | Analytic exponential cooling with conserved initial water mass; first-order BE error bound ΔT λ² t dt / 2 |
| Cooling conservation dt=0.050000 s | thermal | 0 | -0.000002192638930864632 | 2.193e-6 | — | 0.001 | PASS | Signed external heat and stored thermal change; no power source |
| Ambient cooling convergence dt=0.025000 s | thermal | 78.08161478024645 | 78.08161605803498 | 1.278e-6 | 1.636e-8 | 0.0000013312578533881196 | PASS | Analytic exponential cooling with conserved initial water mass; first-order BE error bound ΔT λ² t dt / 2 |
| Cooling conservation dt=0.025000 s | thermal | 0 | -0.0000022391031961888075 | 2.239e-6 | — | 0.001 | PASS | Signed external heat and stored thermal change; no power source |
| Ambient cooling convergence dt=0.016667 s | thermal | 78.08161478024645 | 78.0816156318544 | 8.516e-7 | 1.091e-8 | 8.90838568925413e-7 | PASS | Analytic exponential cooling with conserved initial water mass; first-order BE error bound ΔT λ² t dt / 2 |
| Cooling conservation dt=0.016667 s | thermal | 0 | 0.000008883638656698167 | 8.884e-6 | — | 0.001 | PASS | Signed external heat and stored thermal change; no power source |
| Halving timestep approximately halves error | numerical | 2 | 1.9999495909140017 | 5.041e-5 | 2.520e-5 | 0.001 | PASS | Backward Euler first-order convergence for smooth single-mass cooling |
| Closed relay and safety current | electrical | 8.324661810613943 | 8.324661810613941 | 1.776e-15 | 2.134e-16 | 1e-9 | PASS | Finite series contact resistances 0.02 Ω and 0.01 Ω |
| Closed-loop regulation inside plausible bounds | automation | 1 | 1 | 0.000e+0 | 0.000e+0 | 0 | PASS | 78/80°C hysteresis; finite element inertia and 8 W/K cooling |
| Long run energy conservation | coupling | 0 | 0.000028385315090417862 | 2.839e-5 | — | 0.001 | PASS | All contact/element heat storage and ambient/coolant exchange included |
| Failed sensor opens controlled heater | automation | 0 | 0 | 0.000e+0 | — | 1e-8 | PASS | Invalid control propagates; NO relay defaults open |
| Independent safety interrupts welded normal contact | safety | 0 | 0 | 0.000e+0 | — | 1e-8 | PASS | Separate safety sensing path, fail-on-invalid enabled |
| Safety remains latched | safety | 1 | 1 | 0.000e+0 | 0.000e+0 | 0 | PASS | Manual reset required; no automatic reset |
| Live mass edit rejected by engine | integrity | 0 | 0 | 0.000e+0 | — | 0 | PASS | No implicit mass or energy injection; Reset required |
| Undersized relay reported outside its rating | protection | 1 | 1 | 0.000e+0 | 0.000e+0 | 0 | PASS | 8.32 A through a paid 5 A model: rating violation reported (scored run fails); no contact-wear model, so no fabricated failure |
| Overloaded contact keeps conducting actual current | electrical | 8.324661810613943 | 8.324661810614487 | 5.436e-13 | 6.530e-14 | 1e-9 | PASS | Failure only through the modelled contact temperature |
| Reset restores initial healthy topology | protection | 1 | 1 | 0.000e+0 | 0.000e+0 | 0 | PASS | Permanent failure replaced only by full experiment Reset |
| Half voltage gives quarter heater power | coupling | 0.25 | 0.25 | 0.000e+0 | 0.000e+0 | 1e-10 | PASS | Same fixed resistor and series contact resistances, Ohm law |
| Complete fault-and-recovery challenge | challenge | 1 | 1 | 0.000e+0 | 0.000e+0 | 0 | PASS | Actual 240 s regulation, coolant reduction/loss, welded relay, independent trip, cool manual reset, 120 s recovery; no temperature script |
| Challenge stays below critical water temperature | safety | 1 | 1 | 0.000e+0 | 0.000e+0 | 0 | PASS | Independent cutoff threshold 90°C; thermal inertia retained |
| Locked environment exploit rejected | integrity | 1 | 1 | 0.000e+0 | 0.000e+0 | 0 | PASS | Challenge initial/environment conditions validated before solver state initializes |
| Coupled mass balance at dt=0.016666666666666666 | multiphysics | 0 | -7.901235221652314e-12 | 7.901e-12 | — | 1e-7 | PASS | Finite tanks; nonlinear continuity tolerance 1e-12 m³/s; no post-integration volume clamp |
| Coupled energy balance at dt=0.016666666666666666 | multiphysics | 0 | -0.0002450886301232913 | 2.451e-4 | — | 0.1 | PASS | Electrical supply = thermal + rotor + hydrostatic storage + ambient + shaft export; explicit storage-head splitting |
| Coupled mass balance at dt=0.008333333333333333 | multiphysics | 0 | -6.45172804070171e-12 | 6.452e-12 | — | 1e-7 | PASS | Finite tanks; nonlinear continuity tolerance 1e-12 m³/s; no post-integration volume clamp |
| Coupled energy balance at dt=0.008333333333333333 | multiphysics | 0 | -0.00024517902190268615 | 2.452e-4 | — | 0.1 | PASS | Electrical supply = thermal + rotor + hydrostatic storage + ambient + shaft export; explicit storage-head splitting |
| Coupled mass balance at dt=0.004166666666666667 | multiphysics | 0 | -3.780087354243733e-12 | 3.780e-12 | — | 1e-7 | PASS | Finite tanks; nonlinear continuity tolerance 1e-12 m³/s; no post-integration volume clamp |
| Coupled energy balance at dt=0.004166666666666667 | multiphysics | 0 | -0.00024564219671674437 | 2.456e-4 | — | 0.1 | PASS | Electrical supply = thermal + rotor + hydrostatic storage + ambient + shaft export; explicit storage-head splitting |
| Coupled mass balance at dt=0.0020833333333333333 | multiphysics | 0 | -1.3926637620897964e-12 | 1.393e-12 | — | 1e-7 | PASS | Finite tanks; nonlinear continuity tolerance 1e-12 m³/s; no post-integration volume clamp |
| Coupled energy balance at dt=0.0020833333333333333 | multiphysics | 0 | -0.00012216273506737707 | 1.222e-4 | — | 0.1 | PASS | Electrical supply = thermal + rotor + hydrostatic storage + ambient + shaft export; explicit storage-head splitting |
| Coupled mass balance at dt=0.0010416666666666667 | multiphysics | 0 | -3.979039320256561e-13 | 3.979e-13 | — | 1e-7 | PASS | Finite tanks; nonlinear continuity tolerance 1e-12 m³/s; no post-integration volume clamp |
| Coupled energy balance at dt=0.0010416666666666667 | multiphysics | 0 | -0.00005621215274231872 | 5.621e-5 | — | 0.1 | PASS | Electrical supply = thermal + rotor + hydrostatic storage + ambient + shaft export; explicit storage-head splitting |
| Destination-volume convergence dt=0.016666666666666666 | multiphysics | 0.0009501158032287586 | 0.0009501318052439609 | 1.600e-8 | 1.684e-5 | 0.000002 | PASS | 2 s startup against dt=1/960 s reference; tolerance 2 mL |
| Motor-current convergence dt=0.016666666666666666 | multiphysics | 5.026534911421837 | 5.02983546814705 | 3.301e-3 | 6.566e-4 | 0.03 | PASS | 2 s startup; midpoint electrical/mechanical coupling; current tolerance 30 mA |
| Motor-speed convergence dt=0.016666666666666666 | multiphysics | 224.6184721077513 | 224.61856492934484 | 9.282e-5 | 4.132e-7 | 0.01 | PASS | 2 s startup; speed tolerance 0.01 rad/s |
| Fluid-temperature convergence dt=0.016666666666666666 | multiphysics | 293.15126593271486 | 293.15126671014514 | 7.774e-7 | 2.652e-9 | 0.001 | PASS | Conservative zero-volume enthalpy transport plus backward-Euler tank loss; tolerance 1 mK |
| Destination-volume convergence dt=0.008333333333333333 | multiphysics | 0.0009501158032287586 | 0.0009501318052380643 | 1.600e-8 | 1.684e-5 | 0.000002 | PASS | 2 s startup against dt=1/960 s reference; tolerance 2 mL |
| Motor-current convergence dt=0.008333333333333333 | multiphysics | 5.026534911421837 | 5.029835468223597 | 3.301e-3 | 6.566e-4 | 0.03 | PASS | 2 s startup; midpoint electrical/mechanical coupling; current tolerance 30 mA |
| Motor-speed convergence dt=0.008333333333333333 | multiphysics | 224.6184721077513 | 224.6185649281993 | 9.282e-5 | 4.132e-7 | 0.01 | PASS | 2 s startup; speed tolerance 0.01 rad/s |
| Fluid-temperature convergence dt=0.008333333333333333 | multiphysics | 293.15126593271486 | 293.1512667130698 | 7.804e-7 | 2.662e-9 | 0.001 | PASS | Conservative zero-volume enthalpy transport plus backward-Euler tank loss; tolerance 1 mK |
| Destination-volume convergence dt=0.004166666666666667 | multiphysics | 0.0009501158032287586 | 0.0009501318052242808 | 1.600e-8 | 1.684e-5 | 0.000002 | PASS | 2 s startup against dt=1/960 s reference; tolerance 2 mL |
| Motor-current convergence dt=0.004166666666666667 | multiphysics | 5.026534911421837 | 5.029835468378705 | 3.301e-3 | 6.566e-4 | 0.03 | PASS | 2 s startup; midpoint electrical/mechanical coupling; current tolerance 30 mA |
| Motor-speed convergence dt=0.004166666666666667 | multiphysics | 224.6184721077513 | 224.61856492586978 | 9.282e-5 | 4.132e-7 | 0.01 | PASS | 2 s startup; speed tolerance 0.01 rad/s |
| Fluid-temperature convergence dt=0.004166666666666667 | multiphysics | 293.15126593271486 | 293.15126671453226 | 7.818e-7 | 2.667e-9 | 0.001 | PASS | Conservative zero-volume enthalpy transport plus backward-Euler tank loss; tolerance 1 mK |
| Destination-volume convergence dt=0.0020833333333333333 | multiphysics | 0.0009501158032287586 | 0.0009501183870865363 | 2.584e-9 | 2.720e-6 | 0.000002 | PASS | 2 s startup against dt=1/960 s reference; tolerance 2 mL |
| Motor-current convergence dt=0.0020833333333333333 | multiphysics | 5.026534911421837 | 5.027633986888566 | 1.099e-3 | 2.187e-4 | 0.03 | PASS | 2 s startup; midpoint electrical/mechanical coupling; current tolerance 30 mA |
| Motor-speed convergence dt=0.0020833333333333333 | multiphysics | 224.6184721077513 | 224.6185007050505 | 2.860e-5 | 1.273e-7 | 0.01 | PASS | 2 s startup; speed tolerance 0.01 rad/s |
| Fluid-temperature convergence dt=0.0020833333333333333 | multiphysics | 293.15126593271486 | 293.1512661989808 | 2.663e-7 | 9.083e-10 | 0.001 | PASS | Conservative zero-volume enthalpy transport plus backward-Euler tank loss; tolerance 1 mK |
| Halved internal timestep reduces volume error | multiphysics | 3 | 6.193063588987437 | 3.193e+0 | 1.064e+0 | 0.5 | FAIL | dt=1/240 and 1/480 against dt=1/960 reference: first-order storage-head splitting predicts finite-reference error ratio 3 |
| Pump shaft input bounds hydraulic output | multiphysics | 1 | 1 | 0.000e+0 | 0.000e+0 | 0 | PASS | Affinity head curve; hydraulic efficiency ≤1; explicit mechanical drag |
| Free-fall velocity dt=0.016666666666666666 | mechanical | -9.80665 | -9.806649999999944 | 5.507e-14 | 5.615e-15 | 1e-8 | PASS | Gravity only; no air drag, no impact; exact constant acceleration velocity |
| Free-fall position dt=0.016666666666666666 | mechanical | 5.096675 | 5.086459739583345 | 1.022e-2 | 2.004e-3 | 0.011 | PASS | Planck semi-implicit Euler; internal h≤1/480 s; position error O(h) |
| Free-fall velocity dt=0.004166666666666667 | mechanical | -9.80665 | -9.806649999999944 | 5.507e-14 | 5.615e-15 | 1e-8 | PASS | Gravity only; no air drag, no impact; exact constant acceleration velocity |
| Free-fall position dt=0.004166666666666667 | mechanical | 5.096675 | 5.086459739583345 | 1.022e-2 | 2.004e-3 | 0.011 | PASS | Planck semi-implicit Euler; internal h≤1/480 s; position error O(h) |
| Free-fall velocity dt=0.0020833333333333333 | mechanical | -9.80665 | -9.806649999999944 | 5.507e-14 | 5.615e-15 | 1e-8 | PASS | Gravity only; no air drag, no impact; exact constant acceleration velocity |
| Free-fall position dt=0.0020833333333333333 | mechanical | 5.096675 | 5.086459739583345 | 1.022e-2 | 2.004e-3 | 0.011 | PASS | Planck semi-implicit Euler; internal h≤1/480 s; position error O(h) |
| Free-fall velocity dt=0.0010416666666666667 | mechanical | -9.80665 | -9.80664999999991 | 8.882e-14 | 9.057e-15 | 1e-8 | PASS | Gravity only; no air drag, no impact; exact constant acceleration velocity |
| Free-fall position dt=0.0010416666666666667 | mechanical | 5.096675 | 5.091567369791699 | 5.108e-3 | 1.002e-3 | 0.011 | PASS | Planck semi-implicit Euler; internal h≤1/480 s; position error O(h) |
| Free-fall halving internal timestep error ratio | mechanical | 2 | 2.00000000001026 | 1.026e-11 | 5.130e-12 | 1e-7 | PASS | h=1/480 versus 1/960 s; analytical reference; O(h) position integration |
| Rigid disk inertia | mechanical | 0.04000000000000001 | 0.04000000000000001 | 0.000e+0 | 0.000e+0 | 1e-10 | PASS | Solid disk with explicit 2 kg mass; radius 0.2 m |
| Constant torque angular acceleration | mechanical | 12.499999999999998 | 12.499999999999934 | 6.395e-14 | 5.116e-15 | 1e-8 | PASS | No other torques; omega=tau t/I |
| Constant torque work balance | mechanical | 0 | 3.197442310920451e-14 | 3.197e-14 | — | 1e-8 | PASS | Integrated torque times midpoint angular velocity equals kinetic-energy change |
| Electrical-spatial shaft energy balance dt=0.016666666666666666 | mechanical | 0 | -7.983125271948666e-11 | 7.983e-11 | — | 0.001 | PASS | Implicit motor midpoint coupled to Planck mass matrix; copper/friction/brake losses explicit |
| Authoritative motor/body shaft speed dt=0.016666666666666666 | mechanical | 0 | 0 | 0.000e+0 | — | 0 | PASS | One angular velocity; rotor inertia added to rigid-body inertia exactly once |
| Electrical-spatial speed convergence dt=0.016666666666666666 | mechanical | 64.26298311651148 | 64.26387263936584 | 8.895e-4 | 1.384e-5 | 0.005 | PASS | 2 s against dt=1/960 s reference; fixed duty and viscous shaft brake |
| Electrical-spatial current convergence dt=0.016666666666666666 | mechanical | 31.96891350689892 | 31.970589039686317 | 1.676e-3 | 5.241e-5 | 0.01 | PASS | MNA back EMF; latest midpoint current has O(h) reporting offset; tolerance 10 mA |
| Electrical-spatial shaft energy balance dt=0.004166666666666667 | mechanical | 0 | -3.771027934362792e-11 | 3.771e-11 | — | 0.001 | PASS | Implicit motor midpoint coupled to Planck mass matrix; copper/friction/brake losses explicit |
| Authoritative motor/body shaft speed dt=0.004166666666666667 | mechanical | 0 | 0 | 0.000e+0 | — | 0 | PASS | One angular velocity; rotor inertia added to rigid-body inertia exactly once |
| Electrical-spatial speed convergence dt=0.004166666666666667 | mechanical | 64.26298311651148 | 64.26387263936584 | 8.895e-4 | 1.384e-5 | 0.005 | PASS | 2 s against dt=1/960 s reference; fixed duty and viscous shaft brake |
| Electrical-spatial current convergence dt=0.004166666666666667 | mechanical | 31.96891350689892 | 31.970589039686317 | 1.676e-3 | 5.241e-5 | 0.01 | PASS | MNA back EMF; latest midpoint current has O(h) reporting offset; tolerance 10 mA |
| Electrical-spatial shaft energy balance dt=0.0020833333333333333 | mechanical | 0 | -1.9135804052439198e-10 | 1.914e-10 | — | 0.001 | PASS | Implicit motor midpoint coupled to Planck mass matrix; copper/friction/brake losses explicit |
| Authoritative motor/body shaft speed dt=0.0020833333333333333 | mechanical | 0 | 0 | 0.000e+0 | — | 0 | PASS | One angular velocity; rotor inertia added to rigid-body inertia exactly once |
| Electrical-spatial speed convergence dt=0.0020833333333333333 | mechanical | 64.26298311651148 | 64.26387263936584 | 8.895e-4 | 1.384e-5 | 0.005 | PASS | 2 s against dt=1/960 s reference; fixed duty and viscous shaft brake |
| Electrical-spatial current convergence dt=0.0020833333333333333 | mechanical | 31.96891350689892 | 31.970589039686317 | 1.676e-3 | 5.241e-5 | 0.01 | PASS | MNA back EMF; latest midpoint current has O(h) reporting offset; tolerance 10 mA |
| Electrical-spatial shaft energy balance dt=0.0010416666666666667 | mechanical | 0 | -2.1326940213839407e-11 | 2.133e-11 | — | 0.001 | PASS | Implicit motor midpoint coupled to Planck mass matrix; copper/friction/brake losses explicit |
| Authoritative motor/body shaft speed dt=0.0010416666666666667 | mechanical | 0 | 0 | 0.000e+0 | — | 0 | PASS | One angular velocity; rotor inertia added to rigid-body inertia exactly once |
| Finer shaft step reduces speed error | mechanical | 1 | 1 | 0.000e+0 | 0.000e+0 | 0 | PASS | h=1/480 against h=1/960 s reference; speed difference below 1 mrad/s |
