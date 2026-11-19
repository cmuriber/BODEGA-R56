// Bodega R-56 — Módulo 4: Nueva Venta / Vale — Lógica de la app
//
// Sigue exactamente la misma filosofía que el Módulo 3 (Manifiesto): tiene
// que funcionar SIN internet — el vale se guarda primero en IndexedDB
// (cola de "pendientes") y se sincroniza solo cuando hay señal. Comparte
// sesión (login) e IndexedDB con los Módulos 1 y 3 — un solo inicio de
// sesión sirve en toda la app.
//
// IMPORTANTE — acciones nuevas de backend que este archivo necesita y que
// TODAVÍA NO EXISTEN en Code.gs (ver code-gs-modulo4.txt para el código a
// pegar):
//   - action=disponible_venta   (lee carros abiertos + disponible por nave/tamaño)
//   - action=clientes           (lee catálogo de clientes para el autocompletado)
//   - action=venta_guardar      (guarda un vale, descuenta inventario)
//   - action=ventas_dia         (lista los vales guardados de una fecha, solo lectura)
// Mientras no estén en el backend, esta pantalla se ve y se siente completa
// pero fallará al intentar cargar disponible/clientes o guardar un vale de
// verdad — no es un bug de este archivo.

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzcXtBzWwZqWpBw7OdA-tLWYxR6g6RmSWUzCb9HQwFQK4yG9VnYtIHdipS3p7SIA7poLg/exec';

// Logo Crespo — para el encabezado del ticket impreso (vale de venta). Va
// embebido como data URI (en vez de un <img src> externo) para que el
// ticket se pueda imprimir sin conexión, igual que el resto de la app.
const LOGO_CRESPO_B64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAfQAAACWCAAAAAAN9iWzAAAoaUlEQVR42u1dd3xVxfL/zuy9CZBCM3QV6YgoigooiA1BQBRUsNefik8sYEFABRSFJxYUREUpooINhEcRFXsBFBERsVAUkN4hEJKcnfn9cW+SW85tSdQk5nzeH8/DzZ7d+e6UnZ1CivLn3/ZwMY4lUk7PUvFQsXG6EqBKVE7Tfw+nC+Gb9cQkUq4w/i2gC2cN7nzO/320n8tx/5eId1Vec/f/AJiTzjzn9FRAUC7nyzjoSlgw4GdWIgtw665ntMxAOfBlG3RheWp4JgsAIghQ4eh2l7eqAcD/qvwpa6CrmE1DXgHnndd8uKPpSSed1KqaT/YrQCjAvnwXlHbQFbTk9m8JgeMQkQVgmrVp3eSompXLqVyKQVcXHhXG5IE7WNyOBQIgqVrtmkc2aZKRklKpkmE2BFJPOdlLDejicryzZt8DLzjs7oojIvX/i0lNSamUnJSU7IXJOe4Rr5aL+NIAuipDOBgsVV454MOoYxCIfFo94JnbTbic9CjpzhkV4p+vHByMrxDP6P6hibpvVMVaUSLOf7x4/CCXu2/+wccTp2Sn3WMmbEPOiIqBoj370cezOS73mxYYepRL7Uw54Us66CrGeXf0twD9ebBSnoBXNWsHvwX2oUmkcfIuS/LQQSjX6f/oozEfq/rTJQYe1H45p+Cl6GfNwUyo7vWdvDkuHA1SXlERLX/+wScm6GL14Kg6YODilYEbQZ6pAmbgsllVgIzRXQEYjgPzeu+WY17SQbeqX3cGvEgbeVhtHlqObr+RwAxzz+F16UDdnTnvXpkRm90NGn+pTjnVSzTo4uj+kZVhDFouVLV5b0WXtgUxI2OS6qpqQO11qrrqnkYAOArujFNXlWNewkEX0WWdAA9w1foCNreqE+vCMKP1V+rIr0cAtddJjqhufO2ytMi4E6PbunLMSzjoVmVibZBBhYdyC8Cyuu8+gBnovUmt1d8ygFpr1aq1qrpscJsKANiQC+Z99uRLi/KnZIJudcsNBMPIeDVAtFv9pROICBWHHVarVtfUBGqtVquqYkV1/9cDjq8IgIMZnoH+h8o65tZaK6UYdBFdcirABkd9FCTa320IJkK9GapW1era2kDNX/PgtFZVd3/86FnJAECG/dfpDO9jtqxjLnk0KqWgi+q02jBgHP9NIOaHRqXAgNDkW99bq+vqAjV+LliqWKuquUuevqZ1ul+uG2OQ/lweUcow5mtnv7X4cMlHHZFEux3iBYNx/Mp8dS5WN/UGGGD09O8Eq7/XAzJWBa1UrKOquufHCde3q50EADhittoyj/nz9Qyndf62xG9uTwRf+967J4GFpdX0Ztbk+c/5s7uWs++21MlJ8vtdmf1xUYF3qlAFV6ly3E2H/ty4ef3GDXLfOWX9Yk3p+Tsc4MD7y17oVcK9zB53zP+8fRZBWJpPycdcGM8N3WVsPq4FVrlLbguRL06qUpMmANTxlnXMhVePcIwAvOPWOm1L9mrdJmd53SWzDJSlxoQT/Jir8K5b++1i63b8BtT9YG6MiogIef8FF+ifbGarqtZsfzK3ZF8du2Ah5ufLl7BV0tQX2+dhDv6u5wvkFiLjIt6DgGdmVv0XBE2spLwwgy/XoZSBLrz66m+MgEjvu0j8mBO90eMLVnENigI0RurivyIM2snX7tt/Ktmge8IxX9t7ubEAyaX3Cvkx3/ffJ3JdI+EIxICWB8IArf1EUJZNpStcSnjXzcuNBVjqj6rgC39Vyrl7ZG6E6Ecf6OVJysC59fOVmFOqQFc+eNvHxgIEz5AG+dZX1o9kIuHKVA46ANaj7/f6mQRppQt0GfqmsQBILr5eCo5lyZEFeDmn++kgtwwUEEBq6pQm0IWnjPHlpGnanSYgtyFakHNU670wJ14b1UJQW3gDQq38VdMCSB8c4rtqqN4gQupWHN8XWzT7KB7ycDDm3z5gfTytN8XrYChuQ07YkERzfJnCpmKpkCn0AVrZkEaN/CUkjegnAFHD2u6gCxmOQaoYq4+jNoShmPHJHETP3f23sAJgNLo73lMWF6t4V+E/3sp08QHlL0rmbi4UWUSId765opAkFfr69U0xCm2QYOgJytBTKqsrD7Iz82uKuqOFV8ywkVcfB/U2vrKRY8IedMvygH8TMAYF3BqI7msfLBIYPXJ8PxDd2xpI/aSYrpbE6pet0G1VpNsZR/ffzhfuTfxr1qpuGtkKx64sVOyOoyuOQZObFuaoqhP55ki0PwxVcqWGVf31ElR5OMotnFid2wCXryns3ZRV/aQ1jh2bqepIfLdsVj9L93lRCHV+C5hadND3nQKkfFQ8oFvVSRlgNJrneg8rVld3BeO6wwkG1FpR/eWhxgDjlPWFmKqjP50AA3jPfuIH1cgkFb0IHlzlNjtHdeIxIKDHmkjbzqq+kA5G45mFupQXq1mPVQEDp03P0WgbBwFRE/s65jP6g4E0jw76/jagSh8WC+iOZt5vwGCkPGPDURernx4LJsa9iQSoiBXV5QNrAcwwOGtzwnN1dM3JMGADoHLPqb+pqrjxe65+lUZU7dvwD1jR1dcChojRZIE7II5m3U9gGCQPy0xcHjmqyy8AGEzAubMP+ANaooNudaQfWUKVpWLjBT2zHajSB8UAulj9o7s/cQLolx06pFV9sToMQEwj4paAYlV10RUZ/ksCMC7cn+BkHf3pJBj/TQKAI3tO2qGq6lgbwNNiHd12GjwYGT68ozqlse+cA4Nqk9VVFGy7xOevZqDb2gRFvBXNeqS2PwSdAdNh8iHVCLyBgr9afVQ+o3fOip/TD54Gqrig6KCL1U9PyAucZ8J1u4PHdPTAfcY3DULShPhYQRzVnHlXpgZE5BtckZlImINY/aI5TMFhhQA0unbCD9k+uuU6juM4uVZVl54JD84/FCrdRXTtzcgfgpE8NoxcYnXFGXl3FMRoOjeRnBBrVRecU2CWEwNo9+RvESyQAtB1QN7fMF4KDoSJCvqh9qAK84sMulV9qWogbdErCHWr63rmVy4hpL4TB+rWqu6f0cUAgcG5jNuy4yeoo/pW7eDVkyEA6eeMmP/L3oIfZn43uAYM6n0fSgpHdUZzP5vnxQu+FMLIIvpB/YLVwyBlXNyK3VrVH25ICso0ISag9p2fHVAXMY98mi6tmrfP0GB9AqBnnQGqMK+ooDua2Z+DPmJwbVY+NmJ1ccuAVTFqfBwDdXFEdf/EthSad0OMe+NlI7F6cKA3/C7SF+lLtVpf3G/ElFnz5r8x+j+nVwEMJ70RQgkR3dqXERIZnDY/hMI6IT3oKwwenBMXUa2jun5gRvg1ChOQfPpTG8ItEOST6MYCRr82WPxFBz37TFDynKKBLlZ/vTCkAhEZDMizkq3qpBowQTM4ZlkU1H3RmcuGneR2r0ts4rMJxFH9snOEJH5iExRSADAb3B2iRq3qzFZhIzCa/R5AY6uHhiSF/IaAG3fFpKpYUf31oUbuCWVkANS77IVVPgskf6Mj77Mra/ppToQXgj8WHfScs8FJs4sEuoh+fmzYtIk8b/uGdTRrsAkhCuOE1ZE+aq2q7l1wTTpAVdqnhrnHCDQu9oStVd3xSHqU/DwiNsYQADKGCQYXByt0Ed3e3+MygsF9BaBb3XG1y9Y06B4jOUSsqq56qE6w+gqJYQFQtc+Unw77liQBoIsOzCMqodJXiYCeew7YO6sooFvVF6rCuHgLW+9WUbW64ZJwdjM4Y5vrYd4R1dxl97dOAtiDvoef4nDUqdLE6NpBrFXdO/b4eGp1EJHfaD4hWC9a1QUnuY7AdNSfeZN39Ocz3HYWMS7eG9nkFGtVcz67uma+pImEOwGocebAj3YEi3ervx9N+dK9+fZEQHc6gb0ziwC6o5m3GxhXb/Yr6ojVRa3d0qBdOcGKqv7ydJfKAAyBMUTlv8aF19PfjYy6Tzn8/lRrv9SM7xKCUf+7EE29+54UeD1ubEiY4PutiH7QFF52T/K94pA76mJFVX8f26liPIUBfJanp2nvUR9skQDQx6HgSNM75EPRQZfOYM87hQfd6q/dwSbQvC3gh+vUqk7PcC85yLjxcDhN1s+4vnq+qcW4X6wODU+pZFSP5Fuwjqoe+OLeusifE8UBOyF9ZtA+8uX2kntQGuMaq6Iqqq9VjxShSgb9ciKZnFvfu7NOQHI4sYmGvt8CoSa/q/WBLpp7YcEZD6NDDdCooOv5YPN2oUEX/bApDOB1WTejwz7NGVwRqP/SiXDj9TslmCY5/7u8EQfkTzIGaa7YYeEqk3HU4ki8nrN8cLvUPKlJuLpPDAnqk/EmxHdg9dNURnKvcQOPDt+xjLa7VdSqHZoENLurmrslxjzJldX3Lby5RVKe6C7YM7FwN0hamQe61e+rFByBeV5ioHcFmzcKC7ro+HQQznph4YRWCAem2a4tVwI4dYl+ViOccmTweCBNrK48AkFWDWOQOiL2XrjweqMf3FDP/eSRzikBLMR4UiacGD3xHoDBPaHnQNExOGOhqq7rE7ZjCRm/qHV053VgtPlRF53pKk4YDcPvCqyubY+gChCE26YNvrhZcoz6ACBK/akA9EcCGL3a8sRA7w7D0wsP+n1AldEHVXVjh1BYCUdPPwOMnhs1V2dVDkPdoOZrwaCvqGVM8Il4kDoq4gwI53WDk39zIejmasEsw3hEdceIYxGV3RlXZ4V74jInbVfJdTSrT/jSkj7XXP35XDAu2qSO7r7T1a5hjHCZ45JK8HCQv2miqu759NGuNaNOk5CSB7roobPytxmj8R8J6HQV7QFD0woNuhzq2fBTVcfm6tJqYbAmp4IwIEutWB3HFOpkabkoaKpWV9QMHsIHuopk3x5OUoN2W8Md/JvSOWTfPCo5qtueO44D03ALwvp9Q5223Z0EVlUd3XRs2DGc3rb6ZRMw/pOpVq3qtLpuup/ahFnwVr+rTiHLHO/kqqo6P487xRuZ3QNAt7rqSBQoh1Y7EgP9Qhi8VgSdvtl/e+7oDeGrJqQ/J2pVxeqwYEcjofua4M9GBF2tHurrJuG7bgmZuNVNVUKHeFStWNXdM/6vqe+NMcycd0T3n3h+caWA31Pj6JjQ/cx4USfVACqMErX+mi5nuJzWkbE8fGMurRo6x+fVii9vNHPB7Q0Q4eQeBPq7ngBpdtqBxEDvBYOphbfeJc/HbGW+J1wK1s+7eRDJuSGAWxnomxmGWCTQVTTruvAtZXDpQQ3xoG2q7AK63xGy441bTqsZmCqQ2vj8AY1gUD26U9jKjxlhrD7qWQ9QbXqeJSCO7roq/JBCPCNO0AvyhTc91T7J9cjhB90DgPC1ExA7luZNLFmTihYYSfk5T9QwY0vov7V5qaX4IzvUO2b3rLwESmMrjbiT48+QI6kwLvd1ExJHZPntlOcrxJVjSqRKR/Tpk7n5zz/Xbd62zyYfUavBUXXr1B29kaXC2LOsifrHdervCK2hOXabRZMXz5S8Kw8j1Sa1GJYdNvGVvRIgJkGV6vS/een0WduUI+GiKprdpmAbMi7ISYTTrV4KDyYVx326bj8h5DoLRyzV3IAdvuG0/Nvfo2aEB9dE4XRV0X2XhRvRjLsckTg4vcDbF+AdUdXXkmAwMpYrX2wvtxNp+x9DPXivZ4TwOuOmBDg9wNPwyxNtInE6A4o//wy9nUk0irp4omErpYa+qZAWwMwsR05sIgwQS+t3ekliWeAk6S/2EBNW23rMw3GXOAUZUhErCmKC2lws6p/jsbfeH6sfnXINlwn1nHGcDbpaU7niYQ7FaUvCrTDYqGjTuz96uXOFSIgp1u8MRC1RAKnY4t69aS4RpIGTtc1erilEkJ6zT5GEN6ekT+puw1F/7ClOIISbmA2TqqoSeTf23eF1uo/U2LjUDHfm9J9aI2QTkkq71NC9vLcQJQ6ISSTlxtmnurq3GSCszw4MJU80IcAUG+ic7LqjAj5lO4xPUdUBr9W1iSc/s1Sf2Cn071Sd+19OOBqeiIiUDt6+wpvb+vnKccByRAgzkV7/ZKqEq5uU5FDd7ziFEqTMapNTIse9rw+ibaaTuHgvHtBjZzQb22sUpY99spIUpno42xpTzg6T8JQ74G2WQpVSHjbbm3v0i/XisSeTwt60IMflhJriDZUahc4kIY6Qj+ABCMGG5f6sSnHQj/4CnR6H8mLtl920uxayc6SROq/0XmRsiL49cEuVTonLUDETnjK5qeNbW1OopeW4ftIUZ/kGipLhsj/oVeZBJAS6AWDxNz1EuLu7FLrIAUu9ae1CQRLPnsu/SDhXypoPBim8j3cVU5xyjf6WBEYlZ3+QDjlwMA7GDeH0vzNrVYtSv4al/uSTg1EndnBWtcT5fHW/3cbe21eoVPZwyd4X9GrPjjj+riL/FeI97ozJIizYNn29ZSDqrHLMK2+3SJDFlHb3Xe1xrhhaGkurMAB7OGg12T/GoStSIVTs1vvf8hhp8voJ+TY8GTH/+fCaRHetAoM/9jjdx3lKIaP7dLoNfrM0jjWnheyb0rRk23JyIz9WrPb4159rKImacUpPTWCL5rlsREon6CHb/LesWOdWRe3gc3qpKjRknBNnN1CfZ6/inQv6aMJ+Hsv/e0hVMfq0UZuYSx3sjLDKBFgdqwwaKbfAP2bIFd0Q9GR/ngUFq7SZNaa2JGwkiFnW7xApgLWDOj64nrmUlV9hACY5mIt3fh/uhwiNaDm+1IIuxEuvuHULwFJ90ILzJPG6hsrb+230CUPmtSM6DltFpYvbGYA3PcT/8V2YKRvK+d1qFtCqVBlyKnz4yS4ziVilw5zHqtg4JDsFI6rIvn2Rv9iWCPP64efcuaZUCXkG4A293Pr2YIirwtpg6V7pkoBtUJo4XYi/uPCeXUyQGo/Paycaj2Mlhz0BiKrSqLcK3LYizFuf7Xj7MmYVLS2gk1Jwh3PB0q9CWNvJDQb9qtMChGLp4XQV3vNwjw+YIdpj/r1pcRlwipcGrQhQ28qv/jfoWk6EePO4c29bTExSWjhdUSvkXfb0kCOMzQ1yajUf6tVSqNMt8Rfdhu5lqNR5bkbrOLW5YtOos+74ifyMLLxkQFaIjaNCvGd8p+u/09LB7QwA9UJ19mcbgvdsoHgnqfREnUBPKJeOI5uq2XF390XMEL3qg/944j+nkdk99qzrPycmUeG1fXeG++lVyGROOffKhcRUSji9TnBfdKX1XwT/KjcnH1aCebyr8F9yn/7XsjnNP/+p/QyRRpOntkjEaFdLvGNKl2s+dpjo0F3LWSP8aO/07pd/fLhUgE5ocASCQZeXAk05xeFDAdEDD94mFH6fXrI3uKjZdHuv7wxDvDd9dB0l6I5RIc56tVuv9w/Tg3MjVclVIZP9Rvf3Sz4HeABCw2O2h9i4n8+4JhDZwwcLQleHPqT8FwVR/HWSnfHGiJ/AKmg54gJK3B0DVaLDc+Z3rjOFNGJ0lVrirH0oDf3TSZNOWRLqcnutd3KAyM/jdIJn0IOhGq3Ei3dhWv3Ey8KApN54b10U7mpWlcjOB0gAE8lcUyGDUmHIKdqGAKn0xfuBr7bnQgGQ4pGHWQmlidNVWF/pNEEYIqfMHlPXxoq6iSgGVIgN6TUXkNWI6kFLi/WO42sFi2ylwyN2FKCua8AAWJPG3K8uuaUlGXQh7y+XX7eeGVL5oQVna2x3TI4gMuzQ61+ZMesCI2pKb4sSBkBo2DSMVEunFoBOq0EAS/qzd7gE+5Zs8V5RxnZ+kxginWYPr2ZjhTwwMsZ30Iiws23/mHp6vPvOhUlRuL1UgC6V2ob/y9O/+n2NSnsWQ2GkxuRbxLUgRMkFXfHLZXdsYFKpMWpux7i8rt5rP5xyMtxtPZaGL9dSEnPRu3POSSq13O5fWvdKIREgypuGOj5eF5q0gtTYpu/0cj3plGzQ33ybGKI95w9MsvGxpiRfu3BaR5XwVB+S1GebCoNV6Lx57/YkWzpbj/krbJwcVhBAeebrJACs+XSUEtm2MzrYCOVwtASLd2VSOfK5N1vHd7niC5qrfPl7Uzsi1IFDZB7vatkfUZ7c9Z05PbxSekGX5PNDcVPNHbTUCKz5/qadRqXHOy0ixHeXbJ1OJNT7w/94E3DHEKtUvPq9N09nCfKqstxyi3DBb7jbzDkngkuteEeXWhTWuGnLkGxyzJLL13isDny9bqSYfirRvne1jaZPa5pgqASxSsXe779zrkqBucb2wlEU2GNWhTpfWnp1OmvTnuGXCPzBMHjmXPar16n67KjUiDH9JZnTCak3L+htEg6CA7FKSs+5r3YyebCztHgyTSnkN7mlEXRP3sH8+ul7Qz00oNGNcdcBT26DFzpF8VyW5GhY0qvHwzIXSi+oJF916XvPfm59KrDmyw1DfXlUOk9teWUitVXn8BgptbfffICcs+d2ipZIVIhoWPn7Nkl15Bb2YEVGJfmi92aeawhEnsfblpXW0HnLUG/fSuHB33TIkve2t5pHPewkfmQTNn9j21suSjKN2uQe7w1XIhlyTZlpB55fSUw7XhoOuhLr/eOqR0/RSxR0Fd6w8G+z/Yoof8mIHFwMI5cO0jLTGpoL8P1PNRfUFZ+siYFPgoacgL/p2XVUaSGhwvafa5zTn01G2QOd5dRrXYBQ+qLPSmPj4HSN+55zyoXLnMFDpVSkxajy45M99shxtaTs9IAPVFMDmrpoLTXLen1uooX7JcLpKrzlthu2GlYmly0mJfAu/s2HWdLGtSpRCl2LC3SWeve6qUDLqy+dHi24NwGdLsQfdB+vDHvt/a6OlJKGuTWL78ohebiH5ZIlf4qL00mvvNBNhglvv3F0buQGoHGDrsKZj126jAHbYbRbyT57+B+mRnjS2u83b/XYW+4oYRcrOVJ8oFd4pK4r6pR137W/RxTxcYp3tcTfXDZkPwvLsS9muIlLm/1PC77Q7b7vzh+9TqdRXMKMuIM5xabTWVo+5FpYQYmnd5nP5N6aO75oWCGzc/B584iEpdbE5q4qMjuryOLYFqvmlEFzvLlNx1cpWUacuoCekIgLLsupN1ztioaK+a3PfRvdW3vHI95F2Xm188h9rMpS9cW27iryQJEjSXNzilEjKD8zwTgZ4xsVyYhTFbFu7KJWpJDqaIeERqd6ycafWxMCumdka3c8LGeOPmea45a2EzPDRUWZll52zTImAalnVA9Xb49i/+6iiufEQReKVFfK8qwhAjPybMs+6EQTxUhFlIjZeF1ERZLxMkFEEi/RGV45dH22N3bbdARfuOQL+Lov9tjsWklPiFZfOe3+9oRQnywDiFK/Q8UQFo+buw8sAKl58uYI0lJX73ERES7OncjLycoJ3TYk0XzIKgYH0iIYcd/3z/I491/vkAXlaXULUPylhYgAydy3ZsXve5Yj9DpretZJLapWIgAWRPFbDcq6PowmYz7pdmkjho1rcp7QILDWT19/yHXvq7LO+6zH9ecaSJDmJz/xIshONvj41Vl7wSIAqWfUHZGq59KnErrfKJWCJY+CEcWZtx2hc8/mpJD5Bl8CbBj+x/QaLvJbePP//eFxLnrAd0WXm5llkVwxxfhoHCfu21au/G3Dn5v25rrJtSVLPBn1GzU7rsVRXn/eVby47/sp7FXmV1+N7Xh+lxoxmMIVdLD03nWHdZd4Qpw57c1eV7WpCYgWNABhhXUDXYWYsPXrqXMtfPV4WMzIuyNUzxX+Y24YYXZO6l85kFOF8WXVFpFR3xwCumKq0+XkIwDrcjWsyjlvD12Le54LK8ILpcy7l3mcthNTsjZtWL9h/YaN2y1SM+o2qd+wwZHpceGulH3Zp/lV99zUorNlyyKg8oltWzQ+upYBXGN1w+6FlVatClODRNjyxhuNr+jUKgWxa+i4tHJ8PPKCiAHT4vYlOb6urVbE6meGcW5wjXgRax2rqocX9zuW80sNMswTEqEyuoj2ddsNp38W0F3Y0ezH0lpviNSW0OpNLlWPk064+zsnoEJ7QHX177sTCKf8ETagiPaHB/XmvndrxyODS/RyzVP7zt/ja9Vh9eGwhg2v5k1X9NDx8HBI15fQtp2+P09v3nPsWlV17LZ6QcdoNjghO5i2jlwboYsbAWkd/vt7fgNt0c7B9Aho5xG23oeiXE4RA6hwzoNz/vT3MHM+9TLOyhIrIiJirXX8pfC3fTisY1JAdUmD1LGR2hlb1ccMucVXpz2yx19CX0RXXQRG1/0R2hLq4fbhZfwNgNRu437V4B7yIrpvZA0w0u5x6d7p6LMeJtRp7B/DMBMRcR5ILe9ZmKNqnRign0TxNO30NwrK6DP5D9WdgaAzAa2el5CpTU+OtI2YAdS57q2dqupIAqCrWH3cE0Ux+Jv5HXXNs/NW7FTVb5MYZ4a0Qty/9uPnb2rMQc2uDGrPjNQBQTRnpMd1pzFw5ueqjqqjOv1oeFDzmcPuoFv9tgoownwzbpixuQB3cVTf7wAAHT9y7QQ6s6J/pDBGJd945rxXt6o6w6OCHnfYpJ/lj+z3ybojC667GWg3fm8opRbWjmL0+Trqthz2VZaqOBIKOqVFAF1FdHwFRG/a6mtMlXFc99smPJFMaL8n14rY3Mxdm9cumXZvz5N9MjGgVRQxmi+K3PRj57WRdAox0ocfUuvorpsNDE75JmJ3HL0+wqyJCaDGt36T7WvJYVW39K0Ig8qjDrjsQ6tL6vjSQAhRWKr5M3v10VDQKRD01uxh5jgtNGICKrZOCRBRx03br6F9b2dnxDD0iQlIbT92i6qeFwQ6ecA/RgBdRXTG0YgeZURk8tswE9JPP7frBV27nHNK0zp5fX/IBLeLQ5efI2Euuq8TPNGC8M7+RHVhOxhwv60RRhHV0d7I5CUDIOWcUd+pqqid3BIEXLREXUazuq5lTBYlJuCkyf0LfkjExnBB4yrRQy0Kvh4Xy1NQN6pmT21XDW3HPj8FHuNTN9EK/ANocMNbe7sWgE5MQPIFW1TcQVe1+kO72JV3idi4bA0yoTKRDLz3HozI56LbWkTrHkOM1EefqAwPak/WCL2wRPcOSYrKAz6xnH7JtI36Y2+AcdQLjpu6Ed3VBSbO8ucpwbIPqPBGAeiHr2nf6cx2LepWTk602jERUvptUHXCjM/l9QKgjSLmDQM4sW4eRZgBNL3tU0dVNZI7Snjb8AnWxOvjIQIpQeH/X+g5EA2fuChaXriu/nbu55sBE6H2IvsOfGc/fby6X3gp7btuFsdyBxNBgMYtv/nT45jLhzZym5LC3jTF2DgLieeV57CAJ6NeyxPqH9G8asDFiIfEOXjowJ7tf8z6OoGK8sbi3Ic6wDUc9Yf1h3ds/GPN1r0HATBFLlZZQA0iCCp3vKp97QhHtoI9Ja83RnHkbxDDc8tvkcz2gmfd61dVjZgdTuyBZ9DuKMJiQ1Ufw8VQoL5e4oSWbzhhfOQ38R5MILKZ/DNOv/CxOWuyo6xuIhLx49V8er9aG0GLqaoe/uOraUPOrx09DNv3T8QAjh/+raha34oRpQuq/tYnCVxE2JmB02ZprL5t1lFVXX5XwwhCnhgNX4syiuiBYV2Oq+rvUBV9zsaLSrdu8fVUdDHcJ1JCJdwZ8LQb/J1/xzg22F/hP8bmOBPiBp2BzksjL9U6jpP3b7+/cEXD6I1/wQykdhq/RwN0BaK2s5e5bVAk2JmBek/vjrBrQ1cjquufqO8GOwPn/xyr413utuWzH2hfy4RZkWFjtVuoEQZz9H/VAjAn3xNVryd1nbdPVawTZXpWJ7g01Iywu9NGH4y1VBXr/976N7pUiqzemYFaty3KCvZRICoMqnuebFxo2IkZqD98TUw2L/igVd0wNCPsqMRIHpoVaxR/L9s1cx69+JjIdg4xKg/fHUnZOPpJDXBBx2TK/3+RBkOX+Y7G3NRuoLtarkQ4+ZO4CSaOqDpfDDjG3QpmAo4dtVpDdzhi7CfVDQ81i9SkNyaTo/lD6zXmrg394tKeFHy8ZBz7vzgIIWL9gm/Lm3e2r+xGCDLA+V9EHMvq537fCPkXnJSanuqNdOxioNWEw/Es0A30s8/3hs2QwTduS4xgjqpuHN02fLXEQJuntwYzeRyg+0DYNK55jAOCC+IMeNtO3qxxSfYQbs95pQYCu9aj9/q4CSHWt8bM74c3MaFCioEa4yPLTqtf+zAnBlCt1S0TF3y5dNnSL96fNrhLw9RQiUwM793b4tvT4aAzxuR+eFFKMFQGqWNt1P7M7itW3ftOGwoei4GGL+9xpT/i4r2d0y+tEuRSjcOX3GjAh4cS4/LAm5BueQcHMqgyOksT2zm+Rri75txcIxAoMsAVyzXKCeDjemAf5DVvmLrycJDL8Jspt7YI7JtGhFPmxLtAN9AfV9Wv7zqiQIoS47gPVAvRqlisauaMXgGSgwg1HtoYYXqIZ8aOqi4b1r6i/0wU2z+LBpe/9Keq65koPpF1cGgqjO9IdGKhCCHWquqqB1vlyz0Gmk2xkedk9ZdGMAADDR74Od9QttbJs8l3Tru6Tt6hkoFbt0U4AcQH+mjJVtUVt9f2T5CAC9cUgWQqc7uZgl4d5y2JuCMR907SzMXDT63mk92Gg8/DRMTMxod4erMbZ29QF1WSGLO/3wJMDLpiixZyILGiumvaGV7AEBkk37Qx2vbx3aaSQWr/9aoSMn3/f//2YH2AmQwyXkpgL7qCro5aq/rrHTUAQwxz96FERXsIRs6cswyIyaDqqMORyYYEVK3qoe+m3tOpRqDm5mDDttZ5901dvNN32V60ZupW110MoNr4nCIQQq2jmjm7txcATp0dXfRYfRZkgDM+VnWfvTiiuv75dgDQYVHcbB4FdB9dVw6pC6DSOC1aF3pxVA++0xkgtPky2lhIVGCq/jpj1P91PrF+NW8Ap6dk1D/5on5Pvbs6pLd8ER6rWfcln/qVatHGEkdVF/SqmHbPrhhOQdGsvoRaA6N6FaxVPTimhblsZ0J70V2nO3m3g/rzTWm1ZsZ2WsbD7bkTWtEVW6NKx8RajKr6dUb2oYN792Zl7d2XK8aTkpGWmpKWlsb+XxRTT0JhfNa4jhR5NFUi+TKpbcyasEo5H2zp0CzG71QMNv/UvmJCcdHCL90cTGqWUQPzqvgIGIs9J0sxEE7FYOv3Z0afHWkhymhH8FGpKhVn+o8SUDx5g8JAHI3t1VczieIoKo3EUq2FX+wbCvqIIQWlm4SomJYaz+w8ha0h7EsSIH8qEQFU7F1HCVJMm4g1rubbFN+2JUq8fR8Ohi3uQMiNGBdXDbWYs/MUur5DMSMcOxWjiB24i/FnKER9711hQnV/EAmLUUTGnF1ZKaNS4p9dYW8OgEpAUYLyB39ZrVLZFvZyv5CWg16Wn/1bwwJ0thxEOaeXZU7H9k3hoO9GOaeXadR/2xKG8IHN5Zxelh+iDxzWkONB5vpy0MvwI/jlHajfX5Bv29nvy0Ev05w+cQsriOWoyvnnNMLiQ6zloJdVRufvp5KCVU6bV1AxXrD0B5SDXmYx395vO8GI547/HXdL/7xrFeVDU8vFe5l1zOQ88DVDbeOpz1S3eLRfXpcJpRmLWf6ZKvjlsPy1mJP0f9braKU+D9dTkJIMHOP40sVY2s2r+k+UHy3n9L/aLbP/znHI1c6zJ9UTIpDy6Ml1fY38hBc9KCTloJc9w91ZIWk9Z84+139fTqpXvX+lR9QQhJ8fJP+AhC8X73+5eP/l9W5tKDADVRhzn/ksF0aguPfBNGvKQS+TFnzQTb0wshe+NEdArNJlbKNyTi97vK5hwRmqDCycueB3wOM0fvCitL+3z0U56P9UV3cDbHx39rK9gPfDjn+vDV8O+j8nAIiQ+8OCWd9fML0Cyjn9X6Pp1QD7v6rX8m/uYlQO+j/M7mpQfmT7d4r5ctDLn7/4+X+uWWUGwP6v/QAAAABJRU5ErkJggg==';

// Misma base de datos que Módulos 1 y 3 — mismos 4 stores, misma versión.
// No se agrega ningún store nuevo: el vale usa el store genérico
// "pendientes" (igual que nave_guardar/manifiesto_crear en el Módulo 3),
// así no hace falta subir DB_VERSION ni tocar los otros dos archivos.
const DB_NAME = 'r56-dashboard';
const DB_VERSION = 3;
const STORE_SNAPSHOTS = 'snapshots';
const STORE_SESION = 'sesion';
const STORE_MANIFIESTOS = 'manifiestosCache';
const STORE_PENDIENTES = 'pendientes';

// Los mismos 10 tamaños y el mismo orden/param que ya usa el Módulo 3
// (CAMPOS_TAMANO en app-manifiesto.js) — tiene que coincidir EXACTO para
// que "disponible" y "venta_guardar" hablen el mismo idioma que el
// manifiesto real.
const CAMPOS_TAMANO = [
  { param: 'cajasXL',      label: 'XL' },
  { param: 'cajasLG',      label: 'LG' },
  { param: 'cajasMD',      label: 'MD' },
  { param: 'cajasSM',      label: 'Small' },
  { param: 'cajasBola',    label: 'Bola' },
  { param: 'cajas2da',     label: 'Segunda' },
  { param: 'cajasGen',     label: 'Genérico' },
  { param: 'cajasPinto',   label: 'Pinto' },
  { param: 'cajasCan',     label: 'Canica' },
  { param: 'cajasAplical', label: 'Aplical' }
];
// Catálogo fijo de colores (no existe en el manifiesto — es propio de la
// venta, viene del vale de papel original).
const COLORES = ['Rojo', 'Naranja', '3/4', 'Rayado', 'Verde'];

// ---------- IndexedDB (idéntico a app.js / app-manifiesto.js) ----------

let dbPromise = null;

function abrirDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    let resuelto = false;

    const timer = setTimeout(() => {
      if (!resuelto) {
        dbPromise = null;
        reject(new Error('No se pudo abrir la base de datos local (bloqueada por otra pestaña de la app). Cierra todas las demás pestañas/ventanas de Bodega R-56 y vuelve a intentar.'));
      }
    }, 6000);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
        db.createObjectStore(STORE_SNAPSHOTS, { keyPath: 'fecha' });
      }
      if (!db.objectStoreNames.contains(STORE_SESION)) {
        db.createObjectStore(STORE_SESION, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_MANIFIESTOS)) {
        db.createObjectStore(STORE_MANIFIESTOS, { keyPath: 'fecha' });
      }
      if (!db.objectStoreNames.contains(STORE_PENDIENTES)) {
        db.createObjectStore(STORE_PENDIENTES, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onblocked = () => {
      console.warn('Apertura de IndexedDB bloqueada por otra pestaña con una versión anterior abierta.');
    };
    req.onsuccess = () => {
      resuelto = true;
      clearTimeout(timer);
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => {
      resuelto = true;
      clearTimeout(timer);
      dbPromise = null;
      reject(req.error);
    };
  });

  return dbPromise;
}

async function guardarSesion(token, nombre, rol) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SESION, 'readwrite');
    tx.objectStore(STORE_SESION).put({ id: 'actual', token, nombre, rol });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function leerSesion() {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SESION, 'readonly');
    const req = tx.objectStore(STORE_SESION).get('actual');
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
async function borrarSesion() {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SESION, 'readwrite');
    tx.objectStore(STORE_SESION).delete('actual');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- Cola de pendientes (idéntico patrón al Módulo 3) ----------

async function encolar(tipo, payload) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PENDIENTES, 'readwrite');
    const req = tx.objectStore(STORE_PENDIENTES).add({ tipo, payload, creadoEn: new Date().toISOString() });
    req.onsuccess = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
}
async function listarPendientes() {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PENDIENTES, 'readonly');
    const req = tx.objectStore(STORE_PENDIENTES).getAll();
    req.onsuccess = () => resolve((req.result || []).sort((a, b) => a.id - b.id));
    req.onerror = () => reject(req.error);
  });
}
async function borrarPendiente(id) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PENDIENTES, 'readwrite');
    tx.objectStore(STORE_PENDIENTES).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function generarIdTemporal() {
  if (window.crypto && crypto.randomUUID) return 'tmp-' + crypto.randomUUID();
  return 'tmp-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

// ---------- JSONP (idéntico a los otros módulos) ----------

let jsonpContador = 0;
function llamarJSONP(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    jsonpContador += 1;
    const callbackName = 'r56cb_' + Date.now() + '_' + jsonpContador;
    const script = document.createElement('script');
    let timer;
    function limpiar() { clearTimeout(timer); delete window[callbackName]; script.remove(); }
    window[callbackName] = (data) => { limpiar(); resolve(data); };
    script.onerror = () => { limpiar(); reject(new Error('No se pudo contactar al servidor (sin internet o URL incorrecta).')); };
    timer = setTimeout(() => { limpiar(); reject(new Error('El servidor tardó demasiado en responder.')); }, timeoutMs);
    const sep = url.includes('?') ? '&' : '?';
    script.src = `${url}${sep}callback=${callbackName}`;
    document.head.appendChild(script);
  });
}

// ---------- Formato ----------

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('es-MX');
function fechaHoyCDMX() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}
function folioStr(n) { return '#' + String(n).padStart(5, '0'); }

// ---------- Estado en memoria ----------

let tokenActual = null;
let usuarioRol = null;
let usuarioNombre = null;
let carrosDisponibles = [];   // respuesta de action=disponible_venta
let clientesCatalogo = [];    // respuesta de action=clientes
let vendidoEnEstaSesion = {}; // reserva local: key -> cajas ya asignadas en partidas de ESTE vale (para no sobrevender contra sí mismo antes de guardar)
let partidas = [];
let partidaAutoId = 1;
// Partida "activa" — a la que apuntan los clics en el panel de Manifiesto
// (consulta). Siempre es una de las partidas visibles; renderPartidas()
// se asegura de que nunca apunte a una partida que ya no existe.
let partidaActivaId = null;
let pendingWarningResolve = null;
let ventasHoy = []; // acción ventas_dia — solo lectura, para el panel de "Vales guardados"
let sincronizando = false;
let folioEditando = null; // null = vale nuevo · número = editando ese vale ya guardado
let proximoFolio = null; // solo de referencia visual — el real lo asigna venta_guardar

// ---------- Sesión / Login (idéntico patrón al Módulo 3) ----------

function mostrarLogin() {
  document.getElementById('login-view').hidden = false;
  document.getElementById('app-view').hidden = true;
}
function mostrarApp() {
  document.getElementById('login-view').hidden = true;
  document.getElementById('app-view').hidden = false;
}
async function volverALogin() {
  await borrarSesion();
  tokenActual = null;
  mostrarLogin();
}

async function iniciarSesionConToken(token, rol, nombre) {
  tokenActual = token;
  usuarioRol = rol;
  usuarioNombre = nombre;
  mostrarApp();
  document.getElementById('admin-chip').hidden = usuarioRol !== 'admin';
  const usuarioChip = document.getElementById('usuario-chip');
  if (usuarioChip) usuarioChip.textContent = usuarioNombre || '';
  // El formulario se muestra de inmediato, vacío, sin esperar nada del
  // servidor — antes se esperaban 3 llamadas seguidas (disponible,
  // clientes, ventas del día), una detrás de otra, antes de dejar ver la
  // pantalla para capturar; eso era la tardanza de varios segundos al
  // entrar al módulo.
  partidas = [nuevaPartida()];
  renderPartidas();

  // El panel de Manifiesto (solo consulta, columna derecha) arranca igual
  // que el formulario: con lo último que ya se había guardado en este
  // dispositivo, de inmediato, en vez de quedarse en blanco/cargando hasta
  // que responda el servidor. cargarDisponible() de todos modos lo vuelve
  // a redibujar en cuanto llega el dato real — esto solo evita el hueco
  // vacío mientras tanto.
  const disponibleGuardado = localStorage.getItem('r56-disponible-venta');
  if (disponibleGuardado) {
    try { carrosDisponibles = JSON.parse(disponibleGuardado); renderManifiestoPanel(); } catch (e) {}
  }

  // Los catálogos se piden los 4 en paralelo (no uno tras otro) y cada
  // uno redibuja su parte en cuanto llega, sin bloquear a los demás.
  const disponiblePromise = cargarDisponible().then(() => renderPartidas());
  cargarClientes();
  cargarVentasHoy();
  cargarSiguienteFolio();
  sincronizar();

  // Deep-link desde el módulo "Reporte de Ventas": entrar a
  // vale.html?folio=1234 abre ese vale directo en edición, sin tener que
  // buscarlo a mano en "Vales guardados". Se espera a que termine
  // cargarDisponible() para que el ajuste de disponible (+1 de las cajas
  // que ya traía este vale) se aplique sobre datos reales, no sobre lo que
  // hubiera en caché local — y se limpia el query param del URL para que
  // un refresh no vuelva a disparar la edición sola.
  const folioDesdeUrl = new URLSearchParams(location.search).get('folio');
  if (folioDesdeUrl) {
    history.replaceState(null, '', location.pathname);
    disponiblePromise.then(() => cargarValeParaEditar(Number(folioDesdeUrl)));
  }
}

document.getElementById('login-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const usuario = document.getElementById('login-usuario').value.trim();
  const password = document.getElementById('login-password').value;
  const boton = document.getElementById('login-submit');
  const errorBox = document.getElementById('login-error');
  errorBox.textContent = '';
  boton.disabled = true;
  boton.textContent = 'Entrando...';
  try {
    const url = `${APPS_SCRIPT_URL}?action=login&usuario=${encodeURIComponent(usuario)}&password=${encodeURIComponent(password)}`;
    const data = await llamarJSONP(url);
    if (!data.ok) { errorBox.textContent = data.error || 'No se pudo iniciar sesión.'; return; }
    await guardarSesion(data.token, data.nombre, data.rol);
    await iniciarSesionConToken(data.token, data.rol, data.nombre);
  } catch (err) {
    errorBox.textContent = 'Sin conexión. Intenta de nuevo.';
  } finally {
    boton.disabled = false;
    boton.textContent = 'Iniciar sesión';
  }
});

document.getElementById('btn-salir').addEventListener('click', async () => {
  await borrarSesion();
  tokenActual = null;
  mostrarLogin();
});

// ---------- Catálogos: disponible (carros/naves) y clientes ----------

async function cargarDisponible() {
  try {
    const data = await llamarJSONP(`${APPS_SCRIPT_URL}?action=disponible_venta&token=${encodeURIComponent(tokenActual)}`);
    if (data.error === 'no_autorizado') { await volverALogin(); return; }
    if (data.ok) {
      carrosDisponibles = data.carros || [];
      localStorage.setItem('r56-disponible-venta', JSON.stringify(carrosDisponibles));
    }
  } catch (err) {
    const guardado = localStorage.getItem('r56-disponible-venta');
    if (guardado) { try { carrosDisponibles = JSON.parse(guardado); } catch (e) {} }
    mostrarError('Sin conexión — mostrando el último disponible guardado. Puede no estar al día.');
  }
  renderManifiestoPanel();
}

async function cargarClientes() {
  try {
    const data = await llamarJSONP(`${APPS_SCRIPT_URL}?action=clientes&token=${encodeURIComponent(tokenActual)}`);
    if (data.ok) {
      clientesCatalogo = data.clientes || [];
      localStorage.setItem('r56-clientes-venta', JSON.stringify(clientesCatalogo));
    }
  } catch (err) {
    const guardado = localStorage.getItem('r56-clientes-venta');
    if (guardado) { try { clientesCatalogo = JSON.parse(guardado); } catch (e) {} }
  }
}

async function cargarVentasHoy() {
  try {
    const fecha = fechaHoyCDMX();
    const data = await llamarJSONP(`${APPS_SCRIPT_URL}?action=ventas_dia&token=${encodeURIComponent(tokenActual)}&fecha=${fecha}`);
    if (data.ok) ventasHoy = data.ventas || [];
  } catch (err) { /* el panel de historial se queda con lo que ya tenía */ }
  renderHistorial();
}

// Solo de referencia — muestra en el recuadro de Folio, como marca de
// agua, el número que le tocaría al próximo vale. El número real y
// definitivo siempre lo asigna el servidor al guardar (venta_guardar).
async function cargarSiguienteFolio() {
  try {
    const data = await llamarJSONP(`${APPS_SCRIPT_URL}?action=siguiente_folio&token=${encodeURIComponent(tokenActual)}`);
    if (data.ok) proximoFolio = data.folio;
  } catch (err) { /* se queda con el último que traía */ }
  renderFolioChip();
}
function renderFolioChip() {
  const el = document.getElementById('folio-chip');
  if (el) el.textContent = proximoFolio ? folioStr(proximoFolio) : '—';
}

function mostrarError(msg) {
  const box = document.getElementById('error-box');
  box.textContent = msg;
  box.hidden = false;
}

// ---------- Disponible: lectura + reserva local mientras se arma el vale ----------

function getCarro(carroId) { return carrosDisponibles.find(c => c.id === carroId); }

// Cuando dos agricultores distintos tienen abierto el mismo número de carro
// (se repite cada temporada — "206 de Jesse" y "206 de Ramón" al mismo
// tiempo), elegir el carro por su número solo ya no alcanza para saber cuál
// de los dos es. Por eso la selección va en dos pasos: primero el número de
// carro (deduplicado — aparece una sola vez aunque lo tengan varios
// agricultores), y ese número decide qué agricultores ofrecer en el
// siguiente campo. Solo cuando también se elige el agricultor queda
// resuelto el manifiesto real (p.carroId).
// Siempre se compara como texto (String(...)) — la hoja de Google Sheets a
// veces guarda el número de carro como número real (206) y otras veces
// como texto ("206") según cómo se haya capturado, y el <select> del HTML
// siempre entrega su value como texto. Comparar 206 === "206" en
// JavaScript da false, así que sin este String(...) la lista de
// agricultores se quedaba vacía en cuanto el carro venía como número.
function carrosUnicosPorNumero() {
  const vistos = new Set();
  const resultado = [];
  carrosDisponibles.forEach(c => {
    const num = String(c.carro);
    if (!vistos.has(num)) { vistos.add(num); resultado.push(num); }
  });
  return resultado;
}
function carrosConNumero(numero) {
  return carrosDisponibles.filter(c => String(c.carro) === String(numero));
}

// El identificador real y único de cada nave es su NaveID (igual que en el
// Módulo 3 real) — el carro (ej. "205") es solo la etiqueta visible, y el
// invernadero/letra/semilla es texto que se repite entre naves distintas.
// Por eso las partidas guardan naveId, no el texto compuesto.
function getNave(carroId, naveId) {
  const carro = getCarro(carroId);
  if (!carro) return null;
  return (carro.naves || []).find(n => n.id === naveId) || null;
}

function disponibleBase(carroId, naveId, tamParam) {
  const nave = getNave(carroId, naveId);
  if (!nave) return 0;
  return Number(nave.disponible && nave.disponible[tamParam]) || 0;
}

// Ajusta "disponible" en memoria SIN esperar al servidor — el mismo truco
// que ya agilizó el Módulo 3 (aplicarNaveLocal): en vez de bloquear la
// pantalla hasta que Sheets confirme y volver a pedirle todo el catálogo,
// aplicamos aquí mismo el cambio que ya sabemos que va a pasar, y de todos
// modos se sincroniza solo con el servidor en segundo plano poco después.
// signo = -1 al vender (descuenta), +1 al restaurar (p.ej. al entrar a
// editar un vale ya guardado, se le regresa lo suyo mientras se edita).
function ajustarDisponibleLocal(filas, signo) {
  filas.forEach(f => {
    const carro = getCarro(f.manifiestoId);
    if (!carro) return;
    const nave = (carro.naves || []).find(n => n.id === f.naveId);
    if (!nave || !nave.disponible) return;
    const actual = Number(nave.disponible[f.tamano]) || 0;
    nave.disponible[f.tamano] = actual + signo * (Number(f.cajas) || 0);
  });
}

// Disponible real considerando lo que YA se apartó en otras partidas de este
// mismo vale (para no permitir, sin avisar, vender dos veces la misma caja
// dentro del mismo vale antes de guardarlo).
function disponibleParaTamano(p, tamParam) {
  if (!p.carroId || !p.naveId) return Infinity;
  const base = disponibleBase(p.carroId, p.naveId, tamParam);
  const reservadoOtras = partidas
    .filter(x => x.id !== p.id && x.carroId === p.carroId && x.naveId === p.naveId)
    .reduce((acc, x) => acc + (Number(x.cajasPorTamano[tamParam]) || 0), 0);
  return base - reservadoOtras;
}

// ---------- Partidas ----------

function nuevaPartida() {
  return {
    id: partidaAutoId++,
    carroNumero: '', carroId: '', naveId: '', precio: '',
    colores: new Set(),
    cajasPorColor: {},
    tamanos: new Set(),
    cajasPorTamano: {},
    cajasPendiente: '',
    overrideTamanos: new Set(),
    esMerma: false,
  };
}

function totalCajasPartida(p) {
  if (p.tamanos.size === 0) return Number(p.cajasPendiente) || 0;
  return Object.values(p.cajasPorTamano).reduce((acc, v) => acc + (Number(v) || 0), 0);
}

function addPartida() {
  if (partidas.length >= 10) return;
  const p = nuevaPartida();
  partidas.push(p);
  // La partida recién agregada se vuelve la activa — así un clic en el
  // Manifiesto después de "+ Agregar partida" llena la nueva, nunca la
  // que ya se había llenado antes.
  partidaActivaId = p.id;
  renderPartidas();
}
function removePartida(id) {
  if (partidas.length <= 1) return;
  partidas = partidas.filter(p => p.id !== id);
  if (partidaActivaId === id) partidaActivaId = partidas[partidas.length - 1].id;
  renderPartidas();
}
function getPartida(id) { return partidas.find(p => p.id === id); }

// ---------- Render: Partidas ----------

function renderPartidas() {
  // Red de seguridad: si por lo que sea la partida activa ya no existe
  // (se borró, se recargó el formulario, etc.), se recorre a la última.
  if (!partidas.find(p => p.id === partidaActivaId)) {
    partidaActivaId = partidas.length ? partidas[partidas.length - 1].id : null;
  }
  const container = document.getElementById('partidas-container');
  container.innerHTML = '';
  partidas.forEach((p, idx) => container.appendChild(renderPartidaCard(p, idx)));
  document.getElementById('partidas-count').textContent = partidas.length + ' de 10';
  document.getElementById('btn-agregar-partida').disabled = partidas.length >= 10;
  computeTotales();
  renderManifiestoPanel();
}

function renderPartidaCard(p, idx) {
  const wrap = document.createElement('div');
  const esActiva = p.id === partidaActivaId;
  wrap.className = 'partida' + (esActiva ? ' partida-activa' : '');
  wrap.dataset.partidaId = p.id;
  const totalCajas = totalCajasPartida(p);
  const total = p.esMerma ? 0 : totalCajas * (Number(p.precio) || 0);
  const multiTamano = p.tamanos.size >= 2;
  const unicoTamano = p.tamanos.size === 1 ? [...p.tamanos][0] : null;
  const multiColor = p.colores.size >= 2;
  const cajasValue = unicoTamano ? (p.cajasPorTamano[unicoTamano] ?? '') : (multiTamano ? totalCajas : p.cajasPendiente);
  const carro = p.carroId ? getCarro(p.carroId) : null;
  // El número de carro puede tener varios agricultores abiertos a la vez
  // (se repite cada año) — el select de Agricultor solo ofrece los que de
  // verdad tienen ESE número abierto ahora mismo. Si nada más hay uno, no
  // hace falta que el usuario elija nada (se resuelve solo).
  const opcionesAgricultor = p.carroNumero ? carrosConNumero(p.carroNumero) : [];

  wrap.innerHTML = `
    <div class="partida-head">
      <span class="partida-tag">Partida ${idx + 1}${esActiva ? ' · Activa' : ''}</span>
      <div class="partida-head-derecha">
        <label class="chip-check merma ${p.esMerma ? 'checked' : ''}" title="Cierre de carro por merma/muestra/reposición — no se cobra">
          <input type="checkbox" data-merma="1" data-id="${p.id}" ${p.esMerma ? 'checked' : ''}>
          Merma
        </label>
        <span class="partida-total">$${fmt(total)}</span>
        <button class="partida-quitar" type="button" ${partidas.length <= 1 ? 'disabled' : ''} data-quitar="${p.id}">Quitar ✕</button>
      </div>
    </div>
    <div class="partida-body">
      <div class="row-campos">
        <div>
          <label>Carro</label>
          <select data-campo="carroNumero" data-id="${p.id}">
            <option value="">Seleccionar…</option>
            ${carrosUnicosPorNumero().map(num => `<option value="${num}" ${p.carroNumero === num ? 'selected' : ''}>${num}</option>`).join('')}
          </select>
        </div>
        <div>
          <label>Agricultor</label>
          <select data-campo="agricultor" data-id="${p.id}" ${!p.carroNumero ? 'disabled' : ''}>
            <option value="">${!p.carroNumero ? 'Elige un carro primero' : (opcionesAgricultor.length > 1 ? 'Seleccionar…' : '')}</option>
            ${opcionesAgricultor.map(c => `<option value="${c.id}" ${p.carroId === c.id ? 'selected' : ''}>${c.agricultor}</option>`).join('')}
          </select>
        </div>
        <div>
          <label>Invernadero</label>
          <select data-campo="invernadero" data-id="${p.id}" ${!p.carroId ? 'disabled' : ''}>
            <option value="">${p.carroId ? 'Seleccionar…' : 'Elige un carro primero'}</option>
            ${carro ? (carro.naves || []).map(n => {
              const compuesto = [n.invernadero, n.letra, n.semilla].filter(Boolean).join(' · ');
              return `<option value="${n.id}" ${p.naveId === n.id ? 'selected' : ''}>${compuesto}</option>`;
            }).join('') : ''}
          </select>
        </div>
        <div>
          <label>Cajas</label>
          <input type="number" min="0" step="1" data-campo="cajas" data-id="${p.id}" value="${cajasValue}" placeholder="0"
            ${multiTamano ? 'readonly title="Se calcula del desglose por tamaño de abajo"' : ''}>
        </div>
        <div>
          <label>Precio</label>
          <input type="number" min="0" step="1" data-campo="precio" data-id="${p.id}"
            value="${p.esMerma ? 0 : p.precio}" placeholder="0" ${p.esMerma ? 'disabled title="Merma: no se cobra"' : ''}>
        </div>
        <div>
          <label>Total</label>
          <div class="total-campo">$${fmt(total)}</div>
        </div>
      </div>

      ${p.esMerma ? `<div class="merma-nota">MERMA: esta partida no se cobra — solo descuenta inventario (cajas dañadas, muestra, reposición, etc.) para poder cerrar el carro.</div>` : ''}

      <div class="checks-fila">
        <div class="checks-grupo">
          <span class="g-label">Color (puedes elegir varios)</span>
          <div class="opciones">
            ${COLORES.map(col => `
              <div class="size-unit">
                <label class="chip-check ${p.colores.has(col) ? 'checked' : ''}">
                  <input type="checkbox" data-color="${col}" data-id="${p.id}" ${p.colores.has(col) ? 'checked' : ''}>
                  ${col}
                </label>
                ${multiColor && p.colores.has(col) ? `
                  <input type="number" min="0" step="1" class="size-qty" data-color-cantidad="${col}" data-id="${p.id}"
                    value="${p.cajasPorColor[col] ?? ''}" placeholder="0">` : ''}
              </div>`).join('')}
          </div>
        </div>
        <div class="checks-grupo">
          <span class="g-label">Tamaño (puedes elegir varios)</span>
          <div class="opciones">
            ${CAMPOS_TAMANO.map(t => `
              <div class="size-unit">
                <label class="chip-check size ${p.tamanos.has(t.param) ? 'checked' : ''}">
                  <input type="checkbox" data-tamano-toggle="${t.param}" data-id="${p.id}" ${p.tamanos.has(t.param) ? 'checked' : ''}>
                  ${t.label}
                </label>
                ${multiTamano && p.tamanos.has(t.param) ? `
                  <input type="number" min="0" step="1" class="size-qty" data-tamano-cantidad="${t.param}" data-id="${p.id}"
                    value="${p.cajasPorTamano[t.param] ?? ''}" placeholder="0">` : ''}
              </div>`).join('')}
          </div>
        </div>
      </div>

      <div class="agotado-aviso ${p.overrideTamanos.size > 0 ? 'show' : ''}" data-aviso="${p.id}">
        ⚠️ Vendiendo por encima del disponible en: ${[...p.overrideTamanos].map(param => (CAMPOS_TAMANO.find(t => t.param === param) || {}).label || param).join(', ')}
      </div>
    </div>
  `;
  return wrap;
}

function findCardEl(id) {
  return [...document.querySelectorAll('.partida')].find(el => el.querySelector(`[data-quitar="${id}"]`));
}
function rebuildCard(p) {
  const idx = partidas.findIndex(x => x.id === p.id);
  const old = findCardEl(p.id);
  if (old && idx !== -1) old.replaceWith(renderPartidaCard(p, idx));
  computeTotales();
}
function refreshCardNumbers(p) {
  const card = findCardEl(p.id);
  if (!card) return;
  const totalCajas = totalCajasPartida(p);
  const total = p.esMerma ? 0 : totalCajas * (Number(p.precio) || 0);
  card.querySelector('.partida-total').textContent = '$' + fmt(total);
  card.querySelector('.total-campo').textContent = '$' + fmt(total);
  const unico = p.tamanos.size === 1 ? [...p.tamanos][0] : null;
  const cajasInput = card.querySelector('[data-campo="cajas"]');
  if (cajasInput && document.activeElement !== cajasInput) {
    cajasInput.value = unico ? (p.cajasPorTamano[unico] ?? '') : (p.tamanos.size >= 2 ? totalCajas : p.cajasPendiente);
  }
  const aviso = card.querySelector(`[data-aviso="${p.id}"]`);
  if (aviso) {
    aviso.classList.toggle('show', p.overrideTamanos.size > 0);
    aviso.innerHTML = `⚠️ Vendiendo por encima del disponible en: ${[...p.overrideTamanos].map(param => (CAMPOS_TAMANO.find(t => t.param === param) || {}).label || param).join(', ')}`;
  }
  computeTotales();
}

function computeTotales() {
  const total = partidas.reduce((acc, p) => acc + (p.esMerma ? 0 : totalCajasPartida(p) * (Number(p.precio) || 0)), 0);
  document.getElementById('total-vale').textContent = '$' + fmt(total);
}

// ---------- Validación de inventario en tiempo real ----------

function mostrarModalAdvertencia(mensaje) {
  return new Promise((resolve) => {
    document.getElementById('modal-msg').textContent = mensaje;
    document.getElementById('modal-aviso').hidden = false;
    pendingWarningResolve = resolve;
  });
}
document.getElementById('modal-no-ajustar').addEventListener('click', () => {
  document.getElementById('modal-aviso').hidden = true;
  if (pendingWarningResolve) { pendingWarningResolve(false); pendingWarningResolve = null; }
});
document.getElementById('modal-si-continuar').addEventListener('click', () => {
  document.getElementById('modal-aviso').hidden = true;
  if (pendingWarningResolve) { pendingWarningResolve(true); pendingWarningResolve = null; }
});

async function validarInventarioTamano(p, tamParam) {
  const cajas = Number(p.cajasPorTamano[tamParam]) || 0;
  if (cajas <= 0) { p.overrideTamanos.delete(tamParam); return; }
  const disp = disponibleParaTamano(p, tamParam);
  if (cajas > disp) {
    const label = (CAMPOS_TAMANO.find(t => t.param === tamParam) || {}).label || tamParam;
    const continuar = await mostrarModalAdvertencia(`Ya vendiste todo el ${label} de esta partida. ¿Deseas continuar de todos modos?`);
    if (continuar) p.overrideTamanos.add(tamParam);
    else p.overrideTamanos.delete(tamParam);
  } else {
    p.overrideTamanos.delete(tamParam);
  }
}
async function validarTodosLosTamanos(p) {
  for (const t of p.tamanos) await validarInventarioTamano(p, t.param || t);
}

// ---------- Eventos delegados en partidas ----------

document.getElementById('partidas-container').addEventListener('change', async (e) => {
  const t = e.target;
  const id = Number(t.dataset.id);
  if (!id) return;
  const p = getPartida(id);
  if (!p) return;

  if (t.dataset.merma) {
    p.esMerma = t.checked;
    p.precio = p.esMerma ? '0' : '';
    rebuildCard(p);
    return;
  }
  if (t.dataset.campo === 'carroNumero') {
    p.carroNumero = t.value;
    // Si solo hay un agricultor con ese número de carro abierto, se
    // resuelve solo — no hace falta que el usuario elija nada en
    // Agricultor. Si hay varios (mismo número, distintos agricultores),
    // se queda sin resolver hasta que elija en el siguiente campo.
    const opciones = p.carroNumero ? carrosConNumero(p.carroNumero) : [];
    p.carroId = opciones.length === 1 ? opciones[0].id : '';
    p.naveId = '';
    p.overrideTamanos.clear();
    rebuildCard(p);
    return;
  }
  if (t.dataset.campo === 'agricultor') {
    p.carroId = t.value;
    p.naveId = '';
    p.overrideTamanos.clear();
    rebuildCard(p);
    return;
  }
  if (t.dataset.tamanoToggle) {
    const tam = t.dataset.tamanoToggle;
    if (t.checked) {
      p.tamanos.add(tam);
      if (p.tamanos.size === 1 && p.cajasPendiente) {
        p.cajasPorTamano[tam] = p.cajasPendiente;
        p.cajasPendiente = '';
      } else if (!(tam in p.cajasPorTamano)) {
        p.cajasPorTamano[tam] = '';
      }
      await validarInventarioTamano(p, tam);
    } else {
      if (p.tamanos.size === 1) p.cajasPendiente = p.cajasPorTamano[tam] ?? '';
      p.tamanos.delete(tam);
      delete p.cajasPorTamano[tam];
      p.overrideTamanos.delete(tam);
    }
    rebuildCard(p);
    return;
  }
  if (t.dataset.campo === 'invernadero') {
    p.naveId = t.value;
    p.overrideTamanos.clear();
    await validarTodosLosTamanos(p);
    refreshCardNumbers(p);
    return;
  }
  if (t.dataset.campo === 'cajas') {
    const unico = p.tamanos.size === 1 ? [...p.tamanos][0] : null;
    if (unico) { p.cajasPorTamano[unico] = t.value; await validarInventarioTamano(p, unico); }
    else if (p.tamanos.size === 0) { p.cajasPendiente = t.value; }
    refreshCardNumbers(p);
    return;
  }
  if (t.dataset.tamanoCantidad) {
    const tam = t.dataset.tamanoCantidad;
    p.cajasPorTamano[tam] = t.value;
    await validarInventarioTamano(p, tam);
    refreshCardNumbers(p);
    return;
  }
  if (t.dataset.campo === 'precio') {
    p.precio = t.value === '' ? '' : String(Math.round(Number(t.value)) || 0);
    t.value = p.precio;
    refreshCardNumbers(p);
    return;
  }
  if (t.dataset.color) {
    const col = t.dataset.color;
    if (t.checked) {
      p.colores.add(col);
      if (!(col in p.cajasPorColor)) p.cajasPorColor[col] = '';
    } else {
      p.colores.delete(col);
      delete p.cajasPorColor[col];
    }
    // Igual que con Tamaño: al marcar/desmarcar un color hace falta
    // repintar la tarjeta completa, porque el cuadro de cantidad por color
    // solo aparece cuando hay 2 o más colores elegidos a la vez.
    rebuildCard(p);
    return;
  }
  if (t.dataset.colorCantidad) {
    p.cajasPorColor[t.dataset.colorCantidad] = t.value;
    return;
  }
});

document.getElementById('partidas-container').addEventListener('input', (e) => {
  const t = e.target;
  const id = Number(t.dataset.id);
  if (!id) return;
  const p = getPartida(id);
  if (!p) return;
  if (t.dataset.campo === 'precio') {
    p.precio = t.value;
    refreshCardNumbers(p);
  }
  if (t.dataset.campo === 'cajas') {
    const unico = p.tamanos.size === 1 ? [...p.tamanos][0] : null;
    if (unico) p.cajasPorTamano[unico] = t.value;
    else if (p.tamanos.size === 0) p.cajasPendiente = t.value;
    refreshCardNumbers(p);
  }
  if (t.dataset.tamanoCantidad) {
    p.cajasPorTamano[t.dataset.tamanoCantidad] = t.value;
    refreshCardNumbers(p);
  }
  if (t.dataset.colorCantidad) {
    p.cajasPorColor[t.dataset.colorCantidad] = t.value;
  }
});

// Marca cuál partida es la "activa" (a la que apuntan los clics del panel
// de Manifiesto) sin volver a pintar toda la tarjeta — así no se pierde el
// foco/cursor de un campo que el usuario apenas tocó.
function marcarPartidaActiva(nuevoId) {
  if (!nuevoId || nuevoId === partidaActivaId) return;
  partidaActivaId = nuevoId;
  document.querySelectorAll('#partidas-container .partida').forEach((el) => {
    const id = Number(el.dataset.partidaId);
    const activa = id === partidaActivaId;
    el.classList.toggle('partida-activa', activa);
    const tagEl = el.querySelector('.partida-tag');
    if (tagEl) {
      const idx = partidas.findIndex(p => p.id === id);
      tagEl.textContent = `Partida ${idx + 1}${activa ? ' · Activa' : ''}`;
    }
  });
  renderManifiestoPanel();
}
document.getElementById('partidas-container').addEventListener('focusin', (e) => {
  const card = e.target.closest('.partida');
  if (card) marcarPartidaActiva(Number(card.dataset.partidaId));
});
document.getElementById('partidas-container').addEventListener('click', (e) => {
  const card = e.target.closest('.partida');
  if (card) marcarPartidaActiva(Number(card.dataset.partidaId));
  const id = e.target.dataset.quitar;
  if (id) removePartida(Number(id));
});
document.getElementById('btn-agregar-partida').addEventListener('click', addPartida);

// ---------- Cliente: autocompletado ----------

const clienteInput = document.getElementById('cliente-input');
const clienteSuggestions = document.getElementById('cliente-suggerencias');
clienteInput.addEventListener('input', () => {
  const q = clienteInput.value.trim().toUpperCase();
  if (!q) { clienteSuggestions.classList.remove('show'); return; }
  const opciones = clientesCatalogo.filter(c => c.nombre.toUpperCase().includes(q)).slice(0, 8);
  if (opciones.length === 0) { clienteSuggestions.classList.remove('show'); return; }
  clienteSuggestions.innerHTML = opciones.map(c => `<div class="opt" data-name="${c.nombre}">${c.nombre}</div>`).join('');
  clienteSuggestions.classList.add('show');
});
clienteInput.addEventListener('blur', () => setTimeout(() => clienteSuggestions.classList.remove('show'), 150));
clienteSuggestions.addEventListener('mousedown', (e) => {
  const name = e.target.closest('.opt')?.dataset.name;
  if (name) { clienteInput.value = name; clienteSuggestions.classList.remove('show'); }
});

// ---------- Panel de manifiesto (solo consulta) ----------

let manifiestoTabActivo = null;
function renderManifiestoPanel() {
  const tabsEl = document.getElementById('manifiesto-tabs');
  if (!manifiestoTabActivo || !getCarro(manifiestoTabActivo)) {
    manifiestoTabActivo = carrosDisponibles.length ? carrosDisponibles[0].id : null;
  }
  // Se le agrega el agricultor a la pestaña (no solo el número de carro) —
  // cuando dos agricultores distintos tienen abierto el mismo número
  // ("206" de Jesse y "206" de Ramón a la vez), con solo el número no se
  // sabía cuál pestaña era cuál.
  tabsEl.innerHTML = carrosDisponibles.map(c => `
    <button data-tab="${c.id}" class="${manifiestoTabActivo === c.id ? 'active' : ''} ${c.esDeHoy ? '' : 'tab-later'}"
      title="Carro ${c.carro} · ${c.agricultor}${c.esDeHoy ? '' : ' · abierto de días anteriores'}">${c.carro} · ${(c.agricultor || '').split(' ')[0]}${c.esDeHoy ? '' : ' ·'}</button>
  `).join('');

  const carro = getCarro(manifiestoTabActivo);
  const bodyEl = document.getElementById('manifiesto-body');
  if (!carro) { bodyEl.innerHTML = '<div class="manifiesto-vacio">Sin carros abiertos.</div>'; return; }

  // El invernadero (ej. "4 · B · ARACELI") ya no se repite en cada
  // renglón de tamaño — se pone una sola vez como encabezado del grupo y
  // abajo se desglosan sus tamaños, así se lee mejor con varias naves.
  //
  // Cada renglón de tamaño es clicable: llena de inmediato Carro/
  // Agricultor/Invernadero + marca ese Tamaño en la partida ACTIVA (ver
  // marcarPartidaActiva/partidaActivaId) — nunca en otra partida ya
  // llenada, para no sobrescribirla por accidente. El renglón que ya
  // quedó marcado en la partida activa se resalta con ✓ para que se vea
  // de un vistazo qué falta.
  const partidaActiva = getPartida(partidaActivaId);
  let rows = '';
  (carro.naves || []).forEach(n => {
    const compuesto = [n.invernadero, n.letra, n.semilla].filter(Boolean).join(' · ');
    rows += `<tr class="nave-fila-titulo"><td colspan="2">${compuesto}</td></tr>`;
    CAMPOS_TAMANO.forEach(t => {
      const actual = Number(n.disponible && n.disponible[t.param]) || 0;
      let cls = '';
      if (actual < 0) cls = 'negativo'; else if (actual === 0) cls = 'cero'; else if (actual <= 5) cls = 'bajo';
      const yaEnPartida = !!(partidaActiva && partidaActiva.carroId === carro.id && partidaActiva.naveId === n.id && partidaActiva.tamanos.has(t.param));
      rows += `<tr class="fila-tamano${yaEnPartida ? ' fila-seleccionada' : ''}" data-nave="${n.id}" data-tam="${t.param}" title="Tocar para llenar la partida activa">
        <td>${yaEnPartida ? '✓ ' : ''}${t.label}</td>
        <td style="text-align:right;"><span class="disp-badge ${cls}">${actual}</span></td>
      </tr>`;
    });
  });
  if (!rows) rows = '<tr><td colspan="2" class="manifiesto-vacio-fila">Sin existencias registradas para este carro.</td></tr>';

  bodyEl.innerHTML = `
    <div class="manifiesto-meta">Carro <b>${carro.carro}</b> · Agricultor <b>${carro.agricultor}</b>${carro.esDeHoy ? '' : ' · <span class="badge-later">Abierto (no es de hoy)</span>'}</div>
    <table class="manifiesto-tabla">
      <thead><tr><th>Tamaño</th><th style="text-align:right;">Disponible</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}
document.getElementById('manifiesto-body').addEventListener('click', async (e) => {
  const fila = e.target.closest('tr[data-tam]');
  if (!fila) return;
  const carro = getCarro(manifiestoTabActivo);
  if (!carro) return;
  const naveId = fila.dataset.nave;
  const tamParam = fila.dataset.tam;

  // Si no hay partida activa válida (no debería pasar, hay red de
  // seguridad en renderPartidas), se usa la última.
  let p = getPartida(partidaActivaId);
  if (!p) { p = partidas[partidas.length - 1]; partidaActivaId = p.id; }
  if (!p) return;

  const cambiaCarroONave = p.carroId !== carro.id || p.naveId !== naveId;
  p.carroNumero = carro.carro;
  p.carroId = carro.id;
  p.naveId = naveId;

  if (p.tamanos.has(tamParam)) {
    // Ya estaba marcado en esta partida: un segundo toque lo quita, igual
    // que destildar el checkbox de Tamaño a mano.
    if (p.tamanos.size === 1) p.cajasPendiente = p.cajasPorTamano[tamParam] ?? '';
    p.tamanos.delete(tamParam);
    delete p.cajasPorTamano[tamParam];
    p.overrideTamanos.delete(tamParam);
  } else {
    p.tamanos.add(tamParam);
    if (p.tamanos.size === 1 && p.cajasPendiente) {
      p.cajasPorTamano[tamParam] = p.cajasPendiente;
      p.cajasPendiente = '';
    } else if (!(tamParam in p.cajasPorTamano)) {
      p.cajasPorTamano[tamParam] = '';
    }
  }

  if (cambiaCarroONave) {
    p.overrideTamanos.clear();
    await validarTodosLosTamanos(p);
  } else if (p.tamanos.has(tamParam)) {
    await validarInventarioTamano(p, tamParam);
  }

  rebuildCard(p);
  renderManifiestoPanel();
});
document.getElementById('manifiesto-tabs').addEventListener('click', (e) => {
  const id = e.target.dataset.tab;
  if (id) { manifiestoTabActivo = id; renderManifiestoPanel(); }
});

// ---------- Historial de vales del día (solo lectura por ahora) ----------

function renderHistorial() {
  const q = document.getElementById('historial-buscar').value.trim().toUpperCase();
  const listEl = document.getElementById('historial-lista');
  const items = [...ventasHoy].reverse().filter(v =>
    !q || folioStr(v.folio).toUpperCase().includes(q) || String(v.cliente).toUpperCase().includes(q)
  );
  if (items.length === 0) {
    listEl.innerHTML = `<div class="historial-vacio">${ventasHoy.length === 0 ? 'Todavía no hay vales guardados hoy.' : 'Sin resultados para esa búsqueda.'}</div>`;
    return;
  }
  const head = `<div class="historial-fila head"><span>Folio</span><span>Cliente</span><span>Tipo</span><span>Total</span><span></span></div>`;
  const rows = items.map(v => `
    <div class="historial-fila" data-folio="${v.folio}" role="button" tabindex="0" title="Tocar para editar este vale">
      <span>${folioStr(v.folio)}</span>
      <span>${v.cliente}</span>
      <span class="tipo-pill ${v.tipo === 'CRÉDITO' ? 'credito' : ''}">${v.tipo === 'CRÉDITO' ? 'Crédito' : 'Efectivo'}</span>
      <span class="monto">$${fmt(v.total)}</span>
      <span class="editar-icono" title="Modificar este vale">✏️</span>
    </div>`).join('');
  listEl.innerHTML = head + rows;
}
document.getElementById('historial-buscar').addEventListener('input', renderHistorial);
document.getElementById('btn-historial').addEventListener('click', () => {
  document.getElementById('historial-overlay').hidden = false;
});
document.getElementById('historial-lista').addEventListener('click', (e) => {
  const fila = e.target.closest('.historial-fila[data-folio]');
  if (fila) cargarValeParaEditar(Number(fila.dataset.folio));
});
document.getElementById('historial-cerrar').addEventListener('click', () => {
  document.getElementById('historial-overlay').hidden = true;
});
document.getElementById('historial-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'historial-overlay') document.getElementById('historial-overlay').hidden = true;
});

// ---------- Guardar / Imprimir / Limpiar (un solo botón) ----------

function partidasValidas() {
  return partidas.filter(p => p.carroId && p.naveId && p.tamanos.size > 0 && (p.esMerma || Number(p.precio) > 0) && totalCajasPartida(p) > 0);
}
function filasPorTamano(validas) {
  const filas = [];
  validas.forEach(p => {
    const carro = getCarro(p.carroId);
    const nave = getNave(p.carroId, p.naveId);
    p.tamanos.forEach(tamParam => {
      const cantidad = Number(p.cajasPorTamano[tamParam]) || 0;
      if (cantidad > 0) filas.push({
        manifiestoId: p.carroId, carro: carro ? carro.carro : '', agricultor: carro ? carro.agricultor : '',
        naveId: p.naveId, invernadero: nave ? nave.invernadero : '', letra: nave ? nave.letra : '', semilla: nave ? nave.semilla : '',
        tamano: tamParam, cajas: cantidad, precio: p.esMerma ? 0 : Number(p.precio), esMerma: !!p.esMerma,
        colores: Array.from(p.colores), coloresCantidades: { ...p.cajasPorColor }
      });
    });
  });
  return filas;
}

// Formato de ticket angosto (impresora térmica de 80mm) — un renglón por
// partida en vez de tabla de columnas, que en 72-76mm de ancho se vuelve
// ilegible. Ver estilos de impresión en vale.html (@media print).
// Genera el patrón de marca de agua diagonal (un mosaico de SVG repetido
// de fondo) para las copias ENTREGA y COPIA. Se repite en mosaico — no es
// una sola palabra al centro — para que atraviese TODO el vale sin
// importar cuántos renglones tenga: un vale de 1 renglón y uno de 10
// quedan igual de cubiertos de orilla a orilla.
// OJO — por qué el texto va con contorno (stroke) y SIN relleno gris
// semitransparente: una impresora térmica normalmente no imprime grises
// de verdad, solo blanco y negro puro (1 bit), así que un relleno al 16%
// de opacidad se puede perder por completo al imprimir (eso explicaría
// que la copia con marca de agua haya salido igual a la original). Un
// contorno negro sólido (100% de tinta, nada de transparencia) sí se
// imprime siempre, y al ser solo la orilla de la letra (no rellena) se ve
// más ligero que el texto normal del vale, sin taparlo.
function marcaAguaDataURI(texto) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220">
    <text x="110" y="120" font-family="Arial, sans-serif" font-weight="800" font-size="30"
      fill="none" stroke="#000" stroke-width="1.4" text-anchor="middle" transform="rotate(-35 110 110)">${texto}</text>
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// Envuelve el cuerpo de un vale ya armado como una "copia" física dentro
// del ticket: sin etiqueta = copia tal cual (la nuestra, sin modificar);
// con etiqueta = con la marca de agua diagonal correspondiente encima.
function envolverCopiaTicket(cuerpoHTML, etiqueta) {
  const marca = etiqueta
    ? `<div class="marca-agua" style="background-image:url('${marcaAguaDataURI(etiqueta)}');"></div>`
    : '';
  return `<div class="ticket-copia">${marca}${cuerpoHTML}</div>`;
}

// Arma el HTML del cuerpo del vale (cabecera + renglones + total) — sin
// envolverlo todavía en ninguna copia. Esto es lo que se repite igual en
// las 3 copias (Original / Entrega / Copia).
function construirCuerpoTicket(folio, cliente, tipo, filas, totalVale) {
  const rows = filas.map(f => {
    const label = (CAMPOS_TAMANO.find(t => t.param === f.tamano) || {}).label || f.tamano;
    const detalle = [f.invernadero, f.letra, f.semilla].filter(Boolean).join(' · ');
    const importe = f.esMerma ? '—' : `$${fmt(f.cajas * f.precio)}`;
    // Inicial del agricultor junto al número de carro: cuando dos
    // agricultores comparten número (206 de Jesse, 206 de Ramón), quien
    // entrega la mercancía (José, Fernando, Pablo) necesita ver de
    // inmediato de cuál de los dos surtir — "206 J" vs "206 R".
    const inicial = (f.agricultor || '').trim().charAt(0).toUpperCase();
    // El color va impreso y bien visible — quien entrega la mercancía
    // necesita ver de qué color es el tomate que va a surtir, igual que ya
    // pasa con el carro y las cajas.
    const coloresTicket = (f.colores && f.colores.length)
      ? `<div class="reng-colores">${f.colores.map(c => {
          const cant = f.coloresCantidades && f.coloresCantidades[c];
          return `<span class="color-chip">${c}${cant ? ` (${cant})` : ''}</span>`;
        }).join('')}</div>`
      : '';
    return `
    <div class="reng">
      <div class="reng-carro">Carro ${f.carro}${inicial ? ` <span class="reng-ini">${inicial}</span>` : ''}</div>
      <div class="reng-detalle">${label}${f.esMerma ? ' (MERMA)' : ''}${detalle ? ' · ' + detalle : ''}</div>
      ${coloresTicket}
      <div class="reng-bottom"><span>${f.cajas} caja${f.cajas === 1 ? '' : 's'}${f.esMerma ? '' : ' × $' + fmt(f.precio)}</span><span>${importe}</span></div>
    </div>`;
  }).join('');
  return `
    <img class="logo-crespo" src="${LOGO_CRESPO_B64}" alt="Crespo">
    <h2>VALE DE VENTA</h2>
    <div class="center">Bodega R-56 · Tomates de Invernadero</div>
    <div class="linea-punteada"></div>
    <div><b>Folio:</b> ${folioStr(folio)}</div>
    <div><b>Fecha:</b> ${fechaHoyCDMX()}</div>
    <div><b>Cliente:</b> ${cliente}</div>
    <div><b>Tipo:</b> ${tipo}</div>
    <div class="linea-punteada"></div>
    ${rows}
    <div class="linea-punteada"></div>
    <div class="tot">TOTAL: $${fmt(totalVale)}</div>
    <div class="center" style="margin-top:14px;">_____________________<br>Firma / Sello</div>
  `;
}

// Imprime las 3 copias del vale (Original / ENTREGA / COPIA) de un jalón,
// en un solo window.print(), con un corte de la impresora entre cada una.
//
// OJO — por qué el alto de @page se calcula aquí en vez de dejarlo en
// "auto": "auto" es lo correcto para que el rollo térmico no intente
// centrar/recortar un ticket pensado para hoja carta, PERO con alto
// "auto" Chrome deja de paginar de verdad — trata TODO el contenido (las
// 3 copias) como una sola página larguísima, así que "page-break-after"
// no sirve para cortar entre copias ahí (se probó: imprimía un solo
// tiket, sin cortes, y a veces repetía el mismo contenido 3 veces por el
// mismo motivo). La solución es fijarle a @page un alto EXACTO — ni
// "auto" ni uno genérico enorme que desperdicie rollo — medido aquí mismo
// del tamaño real que va a ocupar una copia (las 3 miden lo mismo: la
// marca de agua es nada más un fondo, no agrega alto). Con un alto fijo,
// Chrome sí pagina de verdad, "page-break-after" sí corta entre páginas,
// y como el alto es el justo del ticket, no se desperdicia papel.
function medirAltoTicketMM(cuerpoHTML) {
  const area = document.getElementById('print-area');
  // Mismas propiedades que definen el layout en @media print (ancho,
  // relleno, tipografía) pero aplicadas aquí vía estilo en línea para
  // poder medir el alto real FUERA de pantalla, sin que el usuario vea
  // nada ni depender de que el navegador ya esté en modo impresión.
  area.style.cssText = 'display:block; visibility:hidden; position:fixed; left:-9999px; top:0; ' +
    'width:72mm; padding:2mm 4mm 6mm; font-family:Inter,sans-serif; font-size:11.5px; line-height:1.4;';
  area.innerHTML = envolverCopiaTicket(cuerpoHTML, null);
  const alturaPx = area.querySelector('.ticket-copia').getBoundingClientRect().height;
  area.style.cssText = ''; // deja que @media print vuelva a mandar, como siempre
  const PX_POR_MM = 96 / 25.4;
  return Math.ceil(alturaPx / PX_POR_MM) + 6; // +6mm de margen de sobra
}

function fijarAltoPaginaTicket(alturaMM) {
  let estilo = document.getElementById('estilo-pagina-ticket');
  if (!estilo) {
    estilo = document.createElement('style');
    estilo.id = 'estilo-pagina-ticket';
    document.head.appendChild(estilo);
  }
  estilo.textContent = `@page { size: 80mm ${alturaMM}mm; margin: 0; }`;
}

function imprimirVale3Copias(folio, cliente, tipo, filas, totalVale) {
  const cuerpo = construirCuerpoTicket(folio, cliente, tipo, filas, totalVale);
  const alturaMM = medirAltoTicketMM(cuerpo);
  fijarAltoPaginaTicket(alturaMM);
  const area = document.getElementById('print-area');
  // Original (sin marca) + ENTREGA + COPIA, cada una en su propia
  // "página" (gracias al alto fijo de arriba, con corte real entre ellas).
  area.innerHTML =
    envolverCopiaTicket(cuerpo, null) +
    envolverCopiaTicket(cuerpo, 'ENTREGA') +
    envolverCopiaTicket(cuerpo, 'COPIA');
  window.print();
}

function resetForm() {
  clienteInput.value = '';
  partidas = [nuevaPartida()];
  renderPartidas();
}

function actualizarBotonImprimirTexto() {
  const boton = document.getElementById('btn-imprimir');
  const botonGuardarSolo = document.getElementById('btn-guardar-sin-imprimir');
  if (folioEditando) {
    boton.textContent = `🖨 Reimprimir vale ${folioStr(folioEditando)}`;
    botonGuardarSolo.hidden = false;
    botonGuardarSolo.textContent = '💾 Guardar cambios (sin reimprimir)';
  } else {
    boton.textContent = '🖨 Imprimir vale';
    botonGuardarSolo.hidden = true;
  }
}

// Junta las filas planas de un vale guardado (una por tamaño) de vuelta en
// partidas (una por carro+nave+esMerma, como las arma el formulario) para
// poder recargarlo y editarlo. Si dos filas comparten carro+nave+esMerma
// se combinan en una sola partida (es lo que hubiera pasado si se hubieran
// capturado juntas desde el principio).
function reconstruirPartidasDesdeFilas(filas) {
  const grupos = {};
  const orden = [];
  filas.forEach(f => {
    const key = f.manifiestoId + '|' + f.naveId + '|' + (f.esMerma ? '1' : '0');
    if (!grupos[key]) {
      grupos[key] = {
        carroNumero: f.carro, carroId: f.manifiestoId, naveId: f.naveId, esMerma: !!f.esMerma,
        precio: f.esMerma ? '0' : String(f.precio || ''),
        tamanos: new Set(), cajasPorTamano: {}
      };
      orden.push(key);
    }
    grupos[key].tamanos.add(f.tamano);
    grupos[key].cajasPorTamano[f.tamano] = String(f.cajas);
  });
  return orden.slice(0, 10).map(key => Object.assign(nuevaPartida(), grupos[key]));
}

// ---------- Editar un vale ya guardado ----------

async function cargarValeParaEditar(folio) {
  try {
    const url = `${APPS_SCRIPT_URL}?action=venta_detalle&token=${encodeURIComponent(tokenActual)}&folio=${encodeURIComponent(folio)}`;
    const data = await llamarJSONP(url);
    if (data.error === 'no_autorizado') { await volverALogin(); return; }
    if (!data.ok) { mostrarToast(data.error || 'No se pudo cargar ese vale.', 'warn'); return; }

    document.getElementById('historial-overlay').hidden = true;

    // Le regresamos localmente a "disponible" las cajas que ya tenía este
    // vale, para no toparnos con avisos de "ya no hay" al re-capturar sus
    // propias cajas mientras se edita.
    ajustarDisponibleLocal(data.filas, +1);
    renderManifiestoPanel();

    folioEditando = folio;
    clienteInput.value = data.cliente || '';
    partidas = reconstruirPartidasDesdeFilas(data.filas);
    if (partidas.length === 0) partidas = [nuevaPartida()];
    renderPartidas();
    actualizarBotonImprimirTexto();

    const banner = document.getElementById('editando-banner');
    banner.hidden = false;
    document.getElementById('editando-texto').textContent = `Editando vale ${folioStr(folio)} — al guardar se actualiza, no se crea uno nuevo.`;
    // "Cancelar vale" borra el registro por completo — solo un admin lo ve.
    document.getElementById('btn-cancelar-vale').hidden = usuarioRol !== 'admin';
    banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (err) {
    mostrarToast('Sin conexión — no se pudo cargar ese vale para editar.', 'warn');
  }
}

// El cliente ya no se llevó la mercancía y el vale no debe contar para
// nada — a diferencia de guardar/imprimir (que se hace optimista, local
// primero), cancelar SÍ espera la confirmación real del servidor antes de
// avisar que ya quedó, porque es irreversible y no hay forma de "reconciliar"
// después si de verdad no se pudo borrar.
document.getElementById('btn-cancelar-vale').addEventListener('click', async () => {
  const folio = folioEditando;
  if (!folio) return;
  const confirmado = window.confirm(`¿Deseas eliminar definitivamente el vale ${folioStr(folio)}?\n\nEsto borra el registro por completo de Sheets (venta y/o merma) y no se puede deshacer.`);
  if (!confirmado) return;

  const boton = document.getElementById('btn-cancelar-vale');
  const botonOriginal = boton.textContent;
  boton.disabled = true;
  document.getElementById('btn-cancelar-edicion').disabled = true;
  document.getElementById('btn-imprimir').disabled = true;
  document.getElementById('btn-guardar-sin-imprimir').disabled = true;
  boton.textContent = 'Eliminando…';

  try {
    if (!navigator.onLine) throw new Error('sin conexión');
    const url = `${APPS_SCRIPT_URL}?action=venta_cancelar&token=${encodeURIComponent(tokenActual)}&folio=${encodeURIComponent(folio)}`;
    const data = await llamarJSONP(url);
    if (data.error === 'no_autorizado') { await volverALogin(); return; }
    if (!data.ok) throw new Error(data.error || 'No se pudo cancelar el vale.');

    mostrarToast(`Vale ${folioStr(folio)} eliminado.`, 'ok');
    // El inventario local ya estaba "regresado" desde que se entró a
    // editar (ajustarDisponibleLocal +1 en cargarValeParaEditar) — al
    // cancelar de verdad, esa reversión es correcta y definitiva, no hay
    // que tocarla otra vez.
    folioEditando = null;
    document.getElementById('editando-banner').hidden = true;
    resetForm();
    actualizarBotonImprimirTexto();
    cargarDisponible();
    cargarVentasHoy();
  } catch (err) {
    mostrarToast(navigator.onLine ? `No se pudo cancelar: ${err.message}` : 'Sin conexión — no se puede cancelar un vale sin conexión. Intenta de nuevo cuando regrese la señal.', 'warn');
  } finally {
    boton.disabled = false;
    boton.textContent = botonOriginal;
    document.getElementById('btn-cancelar-edicion').disabled = false;
    document.getElementById('btn-imprimir').disabled = false;
    document.getElementById('btn-guardar-sin-imprimir').disabled = false;
  }
});

document.getElementById('btn-cancelar-edicion').addEventListener('click', async () => {
  folioEditando = null;
  document.getElementById('editando-banner').hidden = true;
  resetForm();
  actualizarBotonImprimirTexto();
  await cargarDisponible(); // vuelve a traer del servidor el disponible real, sin el ajuste local temporal de arriba
});

// Un vale nuevo siempre se guarda Y se imprime junto (así se ha manejado
// siempre). Uno que se está EDITANDO tiene dos botones separados: "Guardar
// cambios" (corrige el registro sin generar una copia nueva — para cuando
// el ajuste es solo interno, ej. un precio mal capturado) y "Reimprimir"
// (guarda igual, pero además entrega una copia física nueva — para cuando
// la corrección sí cambia lo que se le debe entregar al cliente). Ambos
// botones llaman a esta misma función, solo cambia si imprimen o no.
async function procesarGuardado(botonActivo, { imprimir }) {
  const validas = partidasValidas();
  if (validas.length === 0) {
    mostrarToast('Completa al menos una partida antes de guardar', 'warn');
    return;
  }
  const filasNuevas = filasPorTamano(validas);
  const clienteRaw = clienteInput.value.trim();
  const cliente = clienteRaw || 'PÚBLICO GENERAL';
  const tipo = clienteRaw ? 'CRÉDITO' : 'EFECTIVO / PÚBLICO GENERAL';
  const totalVale = filasNuevas.reduce((a, f) => a + (f.esMerma ? 0 : f.cajas * f.precio), 0);
  const editandoAhora = folioEditando;
  const btnImprimir = document.getElementById('btn-imprimir');
  const btnGuardarSolo = document.getElementById('btn-guardar-sin-imprimir');
  btnImprimir.disabled = true;
  btnGuardarSolo.disabled = true;

  // El folio a usar: si estamos editando, es el mismo de siempre (no
  // cambia). Si es un vale nuevo, usamos el que ya trajimos por
  // adelantado con cargarSiguienteFolio() al abrir el módulo — normalmente
  // ya está listo, así que no hay que esperar red para saberlo. Solo en el
  // caso raro de que aún no haya llegado lo pedimos aquí (rápido, de solo
  // lectura) antes de continuar.
  let folioUsado = editandoAhora || proximoFolio;
  if (!folioUsado) {
    botonActivo.textContent = 'Preparando…';
    try {
      const data = await llamarJSONP(`${APPS_SCRIPT_URL}?action=siguiente_folio&token=${encodeURIComponent(tokenActual)}`);
      if (data.ok) folioUsado = data.folio;
    } catch (err) { /* sin conexión — se imprime con folio pendiente y ya se corrige al sincronizar */ }
  }

  const payload = { cliente: clienteRaw, filas: filasNuevas, fecha: fechaHoyCDMX() };
  if (editandoAhora) payload.folioEditar = editandoAhora;
  else if (folioUsado) payload.folioSugerido = folioUsado;

  // 1) Todo se refleja en pantalla (y se imprime, si toca) DE INMEDIATO,
  // sin esperar a que Sheets confirme — el mismo truco que ya agilizó el
  // Módulo 3 (Manifiesto): la fuente de verdad se sincroniza después, en
  // segundo plano, pero quien está en caja no pierde ni un segundo.
  ajustarDisponibleLocal(filasNuevas, -1);
  renderManifiestoPanel();
  if (imprimir) {
    imprimirVale3Copias(folioUsado || '?????', cliente, tipo, filasNuevas, totalVale);
  }
  mostrarToast(`Vale ${folioStr(folioUsado)} ${editandoAhora ? 'actualizado' : 'guardado'}${imprimir ? ' e impreso' : ''} — ${cliente} — $${fmt(totalVale)}`, 'ok');

  // Si el folio usado fue nuestra propia estimación, ya reservamos el
  // siguiente en pantalla para el próximo vale (se corrige solo si hiciera
  // falta cuando cargarSiguienteFolio() responda de verdad, abajo).
  if (!editandoAhora && typeof folioUsado === 'number') {
    proximoFolio = folioUsado + 1;
    renderFolioChip();
  }

  folioEditando = null;
  document.getElementById('editando-banner').hidden = true;
  resetForm();
  actualizarBotonImprimirTexto();
  btnImprimir.disabled = false;
  btnGuardarSolo.disabled = false;

  // 2) Ahora sí, en segundo plano, se guarda de verdad en Sheets (o se
  // encola si no hay conexión, igual que siempre). Esto ya NO bloquea que
  // se pueda capturar el siguiente vale de inmediato.
  guardarValeEnSegundoPlano(payload, editandoAhora);
}

document.getElementById('btn-imprimir').addEventListener('click', () => {
  procesarGuardado(document.getElementById('btn-imprimir'), { imprimir: true });
});
document.getElementById('btn-guardar-sin-imprimir').addEventListener('click', () => {
  procesarGuardado(document.getElementById('btn-guardar-sin-imprimir'), { imprimir: false });
});

async function guardarValeEnSegundoPlano(payload, editandoAhora) {
  try {
    if (!navigator.onLine) throw new Error('sin conexión');
    const params = new URLSearchParams({ action: 'venta_guardar', token: tokenActual, cliente: payload.cliente, fecha: payload.fecha, filas: JSON.stringify(payload.filas) });
    if (payload.folioEditar) params.set('folioEditar', payload.folioEditar);
    if (payload.folioSugerido) params.set('folioSugerido', payload.folioSugerido);
    const data = await llamarJSONP(`${APPS_SCRIPT_URL}?${params.toString()}`);
    if (!data.ok) throw new Error(data.error || 'error al guardar');
  } catch (err) {
    await encolar('venta_guardar', payload);
    mostrarToast('El vale ya se imprimió — se está guardando en Sheets en segundo plano (o en cuanto regrese la señal).', 'info');
  } finally {
    // El catálogo real y el historial se refrescan al final, sin bloquear
    // nada — ya sirvieron su propósito los ajustes optimistas de arriba.
    cargarDisponible();
    cargarVentasHoy();
    // Solo si fue un vale NUEVO se consumió un folio — al editar uno ya
    // guardado, el próximo folio que le toca al siguiente vale no cambia.
    if (!editandoAhora) cargarSiguienteFolio();
  }
}

function mostrarToast(msg, tipo) {
  const el = document.getElementById('toast');
  el.textContent = (tipo === 'ok' ? '✓ ' : tipo === 'warn' ? '⚠ ' : 'ℹ ') + msg;
  el.className = tipo === 'ok' ? '' : 'toast--pendiente';
  el.hidden = false;
  clearTimeout(mostrarToast._t);
  mostrarToast._t = setTimeout(() => { el.hidden = true; }, 4200);
}

// ---------- Sincronización de la cola cuando regresa la señal ----------

async function sincronizar() {
  if (sincronizando || !navigator.onLine || !tokenActual) return;
  sincronizando = true;
  try {
    const pendientes = await listarPendientes();
    for (const item of pendientes) {
      if (item.tipo !== 'venta_guardar') continue; // lo de otros módulos lo sincroniza su propia pantalla
      try {
        const p = item.payload;
        const params = new URLSearchParams({ action: 'venta_guardar', token: tokenActual, cliente: p.cliente, fecha: p.fecha, filas: JSON.stringify(p.filas) });
        if (p.folioEditar) params.set('folioEditar', p.folioEditar);
        if (p.folioSugerido) params.set('folioSugerido', p.folioSugerido);
        const data = await llamarJSONP(`${APPS_SCRIPT_URL}?${params.toString()}`);
        if (!data.ok) throw new Error(data.error || 'error');
        await borrarPendiente(item.id);
      } catch (err) {
        break; // se corta la conexión a media pasada — se reintenta después, sin perder el orden
      }
    }
    await cargarDisponible();
    await cargarVentasHoy();
  } finally {
    sincronizando = false;
  }
}
window.addEventListener('online', sincronizar);
setInterval(sincronizar, 20000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && tokenActual) sincronizar();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// ---------- Arranque ----------

(async function arrancar() {
  const sesion = await leerSesion().catch(() => null);
  if (sesion && sesion.token) {
    await iniciarSesionConToken(sesion.token, sesion.rol, sesion.nombre);
  } else {
    mostrarLogin();
  }
})();
