import { SearchIcon } from '@heroicons/react/outline'
import { XCircleIcon } from '@heroicons/react/solid'
import chain from '@sushiswap/chain'
import { Token, Type } from '@sushiswap/currency'
import { classNames, Currency, Input, Loader, NetworkIcon, Overlay, SlideIn, Typography } from '@sushiswap/ui'
import React, { FC, useCallback } from 'react'

import { TokenListFilterByQuery } from '../TokenListFilterByQuery'
import { TokenSelectorProps } from './TokenSelector'
import { TokenSelectorImportRow } from './TokenSelectorImportRow'
import { TokenSelectorRow } from './TokenSelectorRow'

export const TokenSelectorOverlay: FC<Omit<TokenSelectorProps, 'variant'>> = ({
  currency,
  open,
  onClose,
  tokenMap,
  chainId,
  onSelect,
  onAddToken,
}) => {
  const handleSelect = useCallback(
    (currency: Type) => {
      onSelect(currency)
      onClose()
    },
    [onClose, onSelect]
  )

  const handleImport = useCallback((currency: Token) => {
    onAddToken(currency)
    onSelect(currency)
    onClose()
  }, [])

  return (
    <TokenListFilterByQuery tokenMap={tokenMap} chainId={chainId}>
      {({ currencies, inputRef, query, onInput, searching, queryToken }) => (
        <SlideIn.FromLeft show={open} unmount={false} onClose={onClose} afterEnter={() => inputRef.current?.focus()}>
          <Overlay.Content className="bg-slate-700 !px-0">
            <Overlay.Header onClose={onClose} title="Select Token" />
            <div className="p-3">
              <div
                className={classNames(
                  'ring-offset-2 ring-offset-slate-900 flex gap-2 bg-slate-800 pr-3 w-full relative flex items-center justify-between gap-1 rounded-xl focus-within:ring-2 text-primary ring-blue'
                )}
              >
                <Input.Address
                  id="token-search"
                  ref={inputRef}
                  placeholder="Search token by address"
                  value={query}
                  onChange={onInput}
                  className={classNames(
                    '!pr-0 !border-none !ring-offset-0 !shadow-none font-bold placeholder:font-medium !ring-0 w-full'
                  )}
                />
                {searching ? (
                  <div className="relative left-[-2px]">
                    <Loader size="14px" strokeWidth={3} className="animate-spin-slow text-slate-500" />
                  </div>
                ) : query ? (
                  <XCircleIcon
                    width={20}
                    height={20}
                    className="cursor-pointer text-slate-500 hover:text-slate-300"
                    onClick={() => onInput('')}
                  />
                ) : (
                  <SearchIcon className="text-slate-500" strokeWidth={2} width={20} height={20} />
                )}
              </div>
            </div>
            <div className="w-full border-t border-slate-200/5" />
            <div
              className={classNames(
                queryToken ? '' : 'relative',
                'bg-slate-800 min-h-[320px] rounded-t-none rounded-xl h-full'
              )}
            >
              {queryToken && (
                <TokenSelectorImportRow hideIcons currency={queryToken} onImport={() => handleImport(queryToken)} />
              )}
              <div
                className={classNames(
                  queryToken
                    ? 'min-h-[272px] max-h-[calc(100%-156px)]'
                    : 'relative min-h-[320px] max-h-[calc(100%-108px)]'
                )}
              >
                <Currency.List
                  className="h-full divide-y hide-scrollbar divide-slate-700"
                  currencies={currencies}
                  rowRenderer={({ currency, style }) => (
                    <TokenSelectorRow currency={currency} style={style} onCurrency={handleSelect} className="!px-4" />
                  )}
                />
              </div>
              {currencies.length === 0 && !queryToken && chainId && (
                <div className="pointer-events-none absolute inset-0 flex justify-center items-center">
                  <div className="flex flex-col gap-1 justify-center items-center">
                    <Typography variant="xs" className="flex italic text-slate-500">
                      No tokens found on
                    </Typography>
                    <Typography variant="xs" weight={700} className="flex gap-1 italic text-slate-500">
                      <NetworkIcon width={14} height={14} chainId={chainId} /> {chain[chainId].name}
                    </Typography>
                  </div>
                </div>
              )}
            </div>
          </Overlay.Content>
        </SlideIn.FromLeft>
      )}
    </TokenListFilterByQuery>
  )
}